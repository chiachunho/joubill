import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { getBot } from "@/bot";
import { db } from "@/db";
import { expenseReceipts, expensePayers, expenseSplits, expenses, groups } from "@/db/schema";
import { assertGroupMember, findUsersNotInGroup, getAuth } from "@/lib/auth";
import { withAuth } from "@/lib/auth/route";
import { fxColumnsFor } from "@/lib/fx";
import { n } from "@/lib/money";
import { deleterOf, loadNoticeRecord, markNoticeDeleted, updateRecordNotice } from "@/lib/notify";
import { resolveReceiptFileIds } from "@/lib/receipts";
import { expenseInputSchema } from "@/lib/zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; expenseId: string }> };

async function resolveIds({ params }: Params) {
  const { id, expenseId } = await params;
  const groupId = Number(id);
  const eid = Number(expenseId);
  if (!Number.isFinite(groupId) || !Number.isFinite(eid)) return null;
  return { groupId, eid };
}

export const GET = withAuth(async (req: Request, ctx: Params) => {
  const auth = await getAuth(req);
  const ids = await resolveIds(ctx);
  if (!ids) return NextResponse.json({ error: "invalid id" }, { status: 400 });
  await assertGroupMember(auth.user.id, ids.groupId);

  const [expense] = await db
    .select()
    .from(expenses)
    .where(
      and(
        eq(expenses.id, ids.eid),
        eq(expenses.groupId, ids.groupId),
        eq(expenses.type, "expense"),
      ),
    );
  if (!expense) return NextResponse.json({ error: "expense not found" }, { status: 404 });

  const [payers, splits, receiptRows] = await Promise.all([
    db
      .select({
        payerId: expensePayers.payerId,
        amount: expensePayers.amount,
      })
      .from(expensePayers)
      .where(eq(expensePayers.expenseId, ids.eid)),
    db
      .select({
        debtorId: expenseSplits.debtorId,
        amount: expenseSplits.amount,
        shareType: expenseSplits.shareType,
        splitValue: expenseSplits.splitValue,
      })
      .from(expenseSplits)
      .where(eq(expenseSplits.expenseId, ids.eid)),
    db
      .select({ fileId: expenseReceipts.fileId })
      .from(expenseReceipts)
      .where(eq(expenseReceipts.expenseId, ids.eid))
      .orderBy(expenseReceipts.position),
  ]);

  const receiptFileIds = resolveReceiptFileIds(
    receiptRows.map((r) => r.fileId),
    expense.receiptFileId,
  );

  return NextResponse.json({
    id: expense.id,
    // Who entered this. The edit form shows it beside the destructive actions —
    // attribution is what replaces the removed owner lock, so dropping it here
    // silently disables the feature (the form's type keeps this honest).
    createdBy: expense.createdBy,
    amount: n(expense.amount),
    currency: expense.currency,
    fxRate: expense.fxRate != null ? n(expense.fxRate) : null,
    fxQuote: expense.fxQuote,
    description: expense.description,
    payers: payers.map((p) => ({ payerId: p.payerId, amount: n(p.amount) })),
    spentAt: expense.spentAt,
    receiptFileIds,
    splits: splits.map((s) => ({
      debtorId: s.debtorId,
      amount: n(s.amount),
      shareType: s.shareType,
      splitValue: s.splitValue != null ? n(s.splitValue) : null,
    })),
  });
});

export const PATCH = withAuth(async (req: Request, ctx: Params) => {
  const auth = await getAuth(req);
  const ids = await resolveIds(ctx);
  if (!ids) return NextResponse.json({ error: "invalid id" }, { status: 400 });
  await assertGroupMember(auth.user.id, ids.groupId);

  const parsed = expenseInputSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const input = parsed.data;

  const [existing] = await db
    .select({ id: expenses.id, currency: expenses.currency, fxQuote: expenses.fxQuote })
    .from(expenses)
    .where(
      and(
        eq(expenses.id, ids.eid),
        eq(expenses.groupId, ids.groupId),
        eq(expenses.type, "expense"),
      ),
    );
  if (!existing) return NextResponse.json({ error: "expense not found" }, { status: 404 });

  const userIds = Array.from(
    new Set([...input.payers.map((p) => p.payerId), ...input.splits.map((s) => s.debtorId)]),
  );
  const missing = await findUsersNotInGroup(ids.groupId, userIds);
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `users not in group: ${missing.join(",")}` },
      { status: 400 },
    );
  }

  const [group] = await db
    .select({ defaultCurrency: groups.defaultCurrency })
    .from(groups)
    .where(eq(groups.id, ids.groupId));
  if (!group) return NextResponse.json({ error: "group not found" }, { status: 404 });

  const fx = fxColumnsFor(group.defaultCurrency, input.currency, input.fxRate);
  // A blank rate field means "automatic", which a dormant pin (stamped for a
  // different default currency) doesn't interfere with — keep it so it can
  // revive if the default reverts, instead of wiping it on unrelated edits.
  const keepDormantPin =
    input.fxRate == null &&
    existing.fxQuote != null &&
    existing.fxQuote !== group.defaultCurrency &&
    input.currency === existing.currency;

  await db.transaction(async (tx) => {
    await tx
      .update(expenses)
      .set({
        amount: input.amount.toFixed(2),
        currency: input.currency,
        ...(!keepDormantPin && { fxRate: fx.fxRate, fxQuote: fx.fxQuote }),
        description: input.description,
        spentAt: new Date(input.spentAt),
        // When receipts are explicitly managed, also clear the legacy single-file column so
        // the GET fallback cannot resurrect a "cleared" bot-uploaded receipt.
        ...(input.receiptFileIds !== undefined && { receiptFileId: null }),
        updatedAt: new Date(),
      })
      .where(eq(expenses.id, ids.eid));

    // Replace payers and splits wholesale.
    await Promise.all([
      tx.delete(expensePayers).where(eq(expensePayers.expenseId, ids.eid)),
      tx.delete(expenseSplits).where(eq(expenseSplits.expenseId, ids.eid)),
    ]);
    await Promise.all([
      tx.insert(expensePayers).values(
        input.payers.map((p) => ({
          expenseId: ids.eid,
          payerId: p.payerId,
          amount: p.amount.toFixed(2),
        })),
      ),
      tx.insert(expenseSplits).values(
        input.splits.map((s) => ({
          expenseId: ids.eid,
          debtorId: s.debtorId,
          amount: s.amount.toFixed(2),
          shareType: input.shareType,
          splitValue: s.splitValue != null ? String(s.splitValue) : null,
        })),
      ),
    ]);

    // Replace receipts when client explicitly sends the field ([] = clear all).
    if (input.receiptFileIds !== undefined) {
      await tx.delete(expenseReceipts).where(eq(expenseReceipts.expenseId, ids.eid));
      if (input.receiptFileIds.length > 0) {
        await tx.insert(expenseReceipts).values(
          input.receiptFileIds.map((fileId, i) => ({
            expenseId: ids.eid,
            fileId,
            position: i,
          })),
        );
      }
    }
  });

  await updateRecordNotice(getBot().api, ids.eid);

  return NextResponse.json({ ok: true });
});

export const DELETE = withAuth(async (req: Request, ctx: Params) => {
  const auth = await getAuth(req);
  const ids = await resolveIds(ctx);
  if (!ids) return NextResponse.json({ error: "invalid id" }, { status: 400 });
  await assertGroupMember(auth.user.id, ids.groupId);

  // Group membership is the only gate: the ledger is shared, so anyone in it can
  // fix a mistake without waiting for whoever typed it. `createdBy` is surfaced
  // in the UI instead, so a change is attributable rather than blocked.
  const [expense] = await db
    .select({ id: expenses.id })
    .from(expenses)
    .where(
      and(
        eq(expenses.id, ids.eid),
        eq(expenses.groupId, ids.groupId),
        eq(expenses.type, "expense"),
      ),
    );
  if (!expense) return NextResponse.json({ error: "expense not found" }, { status: 404 });

  // Snapshot the notice before the row (and its message id) disappear.
  const notice = await loadNoticeRecord(ids.eid);

  await db.delete(expenses).where(and(eq(expenses.id, ids.eid), eq(expenses.groupId, ids.groupId)));
  // expense_payers and expense_splits cascade-deleted via FK.

  await markNoticeDeleted(getBot().api, notice, deleterOf(auth.user));

  return NextResponse.json({ ok: true });
});
