import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { expenseReceipts, expensePayers, expenseSplits, expenses } from "@/db/schema";
import { assertGroupMember, getAuth } from "@/lib/auth";
import { withAuth } from "@/lib/auth/route";
import { n } from "@/lib/money";
import { loadLastActivity } from "@/lib/record-history";
import { deleteRecord, updateExpense } from "@/lib/records";
import { resolveReceiptFileIds } from "@/lib/receipts";
import { receiptPhotoUrl } from "@/lib/tg-photo-sign";
import { expenseInputSchema } from "@/lib/zod";
import { requireId } from "@/lib/route-params";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; expenseId: string }> };

async function resolveIds({ params }: Params) {
  const { id, expenseId } = await params;
  return { groupId: requireId(id, "group id"), eid: requireId(expenseId, "expense id") };
}

export const GET = withAuth(async (req: Request, ctx: Params) => {
  const auth = await getAuth(req);
  const ids = await resolveIds(ctx);
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

  const lastActivity = await loadLastActivity(ids.eid);

  return NextResponse.json({
    id: expense.id,
    // Who entered this. The edit form shows it beside the destructive actions —
    // attribution is what replaces the removed owner lock, so dropping it here
    // silently disables the feature (the form's type keeps this honest).
    createdBy: expense.createdBy,
    // When they entered it. Distinct from spentAt, which is the date of the
    // expense itself and is already an editable field on the form.
    createdAt: expense.createdAt,
    // Null until someone edits it: createdBy already speaks for an untouched
    // record, and repeating it as "last modified" would be noise.
    lastActivity: lastActivity && {
      actorId: lastActivity.actor?.userId ?? null,
      at: lastActivity.at,
    },
    amount: n(expense.amount),
    currency: expense.currency,
    fxRate: expense.fxRate != null ? n(expense.fxRate) : null,
    fxQuote: expense.fxQuote,
    description: expense.description,
    payers: payers.map((p) => ({ payerId: p.payerId, amount: n(p.amount) })),
    spentAt: expense.spentAt,
    receiptFileIds,
    // Signed proxy links, by file id: <img> cannot send the auth header (see tg-photo-sign.ts).
    receiptUrls: Object.fromEntries(receiptFileIds.map((id) => [id, receiptPhotoUrl(id)])),
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
  await assertGroupMember(auth.user.id, ids.groupId);

  const parsed = expenseInputSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  await updateExpense(ids.groupId, ids.eid, parsed.data, {
    actor: { userId: auth.user.id, source: "app" },
  });
  return NextResponse.json({ ok: true });
});

export const DELETE = withAuth(async (req: Request, ctx: Params) => {
  const auth = await getAuth(req);
  const ids = await resolveIds(ctx);
  await assertGroupMember(auth.user.id, ids.groupId);

  await deleteRecord(ids.groupId, ids.eid, "expense", auth.user, {
    actor: { userId: auth.user.id, source: "app" },
  });
  return NextResponse.json({ ok: true });
});
