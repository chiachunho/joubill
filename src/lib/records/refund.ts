import { and, asc, eq } from "drizzle-orm";

import { db } from "@/db";
import {
  expensePayers,
  expenseReceipts,
  expenseSplits,
  expenses,
  groups,
  type User,
} from "@/db/schema";
import { BadRequestError, NotFoundError } from "@/lib/auth/errors";
import {
  fxColumnsFor,
  groupTimeZone,
  loadGroupRateContext,
  resolveRate,
  spentAtForNow,
} from "@/lib/fx";
import { n } from "@/lib/money";
import { logCreated, logDeleted, logUpdated, type Tx } from "@/lib/record-mutation";
import {
  customShares,
  defaultRefundDescription,
  ratioShares,
  type RefundShare,
} from "@/lib/refund";
import type { RefundInput, RefundSplit } from "@/lib/zod";

import { assertUnchangedSince, assertUsersInGroup, replacePayersAndSplits } from "./shared";
import { apiOf, type RecordContext, type UpdateOptions } from "./types";

/**
 * Refunds (issue #178): money that came back on an expense, shared back to the people
 * who split it. Stored as a `type='refund'` expense whose payers are those people (what
 * each gets back) and whose sole split is the person it was paid out to, so balances,
 * FX and settle-up need nothing new.
 *
 * Every write goes through `logCreated` / `logUpdated` / `logDeleted` like any record.
 * Two writes happen on someone else's behalf, and both are logged with a cause:
 * `syncRefundsOf` (the parent's split changed, so a 'ratio' refund is recomputed) and
 * `deleteRefundsOf` (the parent is being deleted). `refund_of_expense_id` has no cascade,
 * so a path that deletes an expense without `deleteRefundsOf` fails loudly.
 */

type Parent = {
  id: number;
  currency: string;
  description: string | null;
  spentAt: string;
  fxRate: string | null;
  fxQuote: string | null;
  splits: RefundShare[];
  /** Who paid the expense, largest share first: a new refund lands with them by default. */
  payers: RefundShare[];
};

async function loadParent(exec: Tx | typeof db, groupId: number, expenseId: number) {
  const [row] = await exec
    .select({
      id: expenses.id,
      currency: expenses.currency,
      description: expenses.description,
      spentAt: expenses.spentAt,
      fxRate: expenses.fxRate,
      fxQuote: expenses.fxQuote,
    })
    .from(expenses)
    .where(
      and(eq(expenses.id, expenseId), eq(expenses.groupId, groupId), eq(expenses.type, "expense")),
    );
  if (!row) return null;
  const [splits, payers] = await Promise.all([
    exec
      .select({ userId: expenseSplits.debtorId, amount: expenseSplits.amount })
      .from(expenseSplits)
      .where(eq(expenseSplits.expenseId, expenseId))
      .orderBy(asc(expenseSplits.id)),
    exec
      .select({ userId: expensePayers.payerId, amount: expensePayers.amount })
      .from(expensePayers)
      .where(eq(expensePayers.expenseId, expenseId))
      .orderBy(asc(expensePayers.id)),
  ]);
  return {
    ...row,
    splits: splits.map((s) => ({ userId: s.userId, amount: n(s.amount) })),
    payers: payers
      .map((p) => ({ userId: p.userId, amount: n(p.amount) }))
      .sort((a, b) => b.amount - a.amount),
  } satisfies Parent;
}

/** What each person gets back, in the refund's currency. */
function sharesFor(
  split: RefundSplit,
  amount: number,
  parent: Parent,
  custom?: RefundShare[],
): RefundShare[] {
  const shares =
    split === "custom" ? customShares(custom ?? []) : ratioShares(amount, parent.splits);
  if (shares.length === 0) throw new BadRequestError("nobody to share the refund back to");
  return shares;
}

function legs(id: number, amount: number, receivedBy: number, shares: RefundShare[]) {
  return {
    payers: shares.map((s) => ({ expenseId: id, payerId: s.userId, amount: s.amount.toFixed(2) })),
    splits: [
      {
        expenseId: id,
        debtorId: receivedBy,
        amount: amount.toFixed(2),
        shareType: "exact" as const,
        splitValue: null,
      },
    ],
  };
}

/**
 * The fx columns a refund stores. A typed rate wins. Otherwise a refund in the parent's
 * currency is pinned to the rate the parent is converted at, so it cancels exactly what
 * was paid; one in another currency is left to the usual rules (group rate, then market).
 */
async function refundFx(
  groupId: number,
  input: Pick<RefundInput, "currency" | "fxRate">,
  parent: Parent,
): Promise<{ fxRate: string | null; fxQuote: string | null }> {
  const [group] = await db
    .select({ defaultCurrency: groups.defaultCurrency })
    .from(groups)
    .where(eq(groups.id, groupId));
  if (!group) throw new NotFoundError("group not found");
  if (input.fxRate != null)
    return fxColumnsFor(group.defaultCurrency, input.currency, input.fxRate);
  if (input.currency !== parent.currency || input.currency === group.defaultCurrency) {
    return { fxRate: null, fxQuote: null };
  }
  const rate = await resolveRate(
    parent,
    group.defaultCurrency,
    parent.spentAt,
    await loadGroupRateContext(groupId),
  ).catch(() => null);
  return rate != null
    ? fxColumnsFor(group.defaultCurrency, input.currency, rate)
    : { fxRate: null, fxQuote: null };
}

function assertAmount(amount: number): void {
  if (!(amount > 0)) throw new BadRequestError("amount must be positive");
}

/** Records a refund on an expense; returns its id. */
export async function createRefund(
  groupId: number,
  expenseId: number,
  input: RefundInput,
  ctx: RecordContext,
): Promise<{ id: number }> {
  assertAmount(input.amount);
  const parent = await loadParent(db, groupId, expenseId);
  if (!parent) throw new NotFoundError("expense not found");
  const shares = sharesFor(input.split, input.amount, parent, input.shares);
  await assertUsersInGroup(groupId, [input.receivedBy, ...shares.map((s) => s.userId)]);

  const [fx, day] = await Promise.all([
    refundFx(groupId, input, parent),
    input.refundedAt ?? groupTimeZone(groupId).then((z) => spentAtForNow(z)),
  ]);
  const description = input.description?.trim() || defaultRefundDescription(parent.description);

  const id = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(expenses)
      .values({
        groupId,
        type: "refund",
        refundOfExpenseId: parent.id,
        refundSplit: input.split,
        amount: input.amount.toFixed(2),
        currency: input.currency,
        description,
        note: input.note ?? null,
        spentAt: day,
        createdBy: ctx.actor.userId,
        fxRate: fx.fxRate,
        fxQuote: fx.fxQuote,
      })
      .returning({ id: expenses.id });

    const l = legs(row.id, input.amount, input.receivedBy, shares);
    const ops: Promise<unknown>[] = [
      tx.insert(expensePayers).values(l.payers),
      tx.insert(expenseSplits).values(l.splits),
    ];
    if (input.receiptFileIds && input.receiptFileIds.length > 0) {
      ops.push(
        tx
          .insert(expenseReceipts)
          .values(
            input.receiptFileIds.map((fileId, i) => ({ expenseId: row.id, fileId, position: i })),
          ),
      );
    }
    await Promise.all(ops);
    return row.id;
  });

  await logCreated(apiOf(ctx), id, ctx.actor);
  return { id };
}

/** The parent expense id of a refund in this group, or a 404. */
export async function refundParentId(groupId: number, refundId: number): Promise<number> {
  const [row] = await db
    .select({ parentId: expenses.refundOfExpenseId })
    .from(expenses)
    .where(
      and(eq(expenses.id, refundId), eq(expenses.groupId, groupId), eq(expenses.type, "refund")),
    );
  if (!row || row.parentId == null) throw new NotFoundError("refund not found");
  return row.parentId;
}

/** Replaces a refund's amount, currency, date, recipient, split and (when given) receipts. */
export async function updateRefund(
  groupId: number,
  refundId: number,
  input: RefundInput,
  ctx: RecordContext,
  opts: UpdateOptions = {},
): Promise<void> {
  assertAmount(input.amount);
  const parentId = await refundParentId(groupId, refundId);
  const parent = await loadParent(db, groupId, parentId);
  if (!parent) throw new NotFoundError("expense not found");
  const shares = sharesFor(input.split, input.amount, parent, input.shares);
  await assertUsersInGroup(groupId, [input.receivedBy, ...shares.map((s) => s.userId)]);
  const fx = await refundFx(groupId, input, parent);

  await logUpdated(apiOf(ctx), refundId, ctx.actor, async (tx) => {
    await assertUnchangedSince(tx, refundId, opts.expectedUpdatedAt);
    await tx
      .update(expenses)
      .set({
        amount: input.amount.toFixed(2),
        currency: input.currency,
        fxRate: fx.fxRate,
        fxQuote: fx.fxQuote,
        refundSplit: input.split,
        ...(input.description !== undefined && {
          description: input.description?.trim() || defaultRefundDescription(parent.description),
        }),
        ...(input.note !== undefined && { note: input.note }),
        ...(input.refundedAt && { spentAt: input.refundedAt }),
        ...(input.receiptFileIds !== undefined && { receiptFileId: null }),
        updatedAt: new Date(),
      })
      .where(eq(expenses.id, refundId));

    const l = legs(refundId, input.amount, input.receivedBy, shares);
    await replacePayersAndSplits(tx, refundId, l.payers, l.splits);

    if (input.receiptFileIds !== undefined) {
      await tx.delete(expenseReceipts).where(eq(expenseReceipts.expenseId, refundId));
      if (input.receiptFileIds.length > 0) {
        await tx
          .insert(expenseReceipts)
          .values(
            input.receiptFileIds.map((fileId, i) => ({ expenseId: refundId, fileId, position: i })),
          );
      }
    }
  });
}

/** The refunds recorded on an expense, oldest first. */
export async function refundIdsOf(
  expenseId: number,
): Promise<Array<{ id: number; split: string | null; amount: number }>> {
  const rows = await db
    .select({ id: expenses.id, split: expenses.refundSplit, amount: expenses.amount })
    .from(expenses)
    .where(and(eq(expenses.refundOfExpenseId, expenseId), eq(expenses.type, "refund")))
    .orderBy(asc(expenses.id));
  return rows.map((r) => ({ id: r.id, split: r.split, amount: n(r.amount) }));
}

/**
 * After an expense's split changed: recomputes each of its 'ratio' refunds from the new
 * split. Each goes through `logUpdated`, so the refund's own history says it moved and
 * why; one whose shares come out the same writes no row. 'custom' refunds are left alone.
 * Errors are logged, not thrown: the parent's save already succeeded.
 */
export async function syncRefundsOf(expenseId: number, ctx: RecordContext): Promise<void> {
  try {
    const refunds = (await refundIdsOf(expenseId)).filter((r) => r.split !== "custom");
    if (refunds.length === 0) return;
    const [owner] = await db
      .select({ groupId: expenses.groupId })
      .from(expenses)
      .where(eq(expenses.id, expenseId));
    if (!owner) return;
    const parent = await loadParent(db, owner.groupId, expenseId);
    if (!parent) return;
    for (const r of refunds) {
      const shares = ratioShares(r.amount, parent.splits);
      if (shares.length === 0) continue;
      await logUpdated(
        apiOf(ctx),
        r.id,
        ctx.actor,
        async (tx) => {
          await tx.delete(expensePayers).where(eq(expensePayers.expenseId, r.id));
          await tx.insert(expensePayers).values(
            shares.map((s) => ({
              expenseId: r.id,
              payerId: s.userId,
              amount: s.amount.toFixed(2),
            })),
          );
          await tx.update(expenses).set({ updatedAt: new Date() }).where(eq(expenses.id, r.id));
        },
        { cause: "parent_updated" },
      );
    }
  } catch (err) {
    console.error("[refund] syncing refunds of expense failed:", expenseId, err);
  }
}

/**
 * Before an expense is deleted: deletes each of its refunds through `logDeleted`, so each
 * leaves an audit row and its group message becomes a tombstone. Must run before the
 * parent's own delete, which the foreign key otherwise refuses.
 */
export async function deleteRefundsOf(
  expenseId: number,
  deleter: User,
  ctx: RecordContext,
): Promise<number> {
  const refunds = await refundIdsOf(expenseId);
  for (const r of refunds) {
    await logDeleted(
      apiOf(ctx),
      r.id,
      ctx.actor,
      deleter,
      async (tx) => {
        await tx.delete(expenses).where(eq(expenses.id, r.id));
      },
      { cause: "parent_deleted" },
    );
  }
  return refunds.length;
}

/** What the expense form lists under 參與者: each refund on the expense. */
export type RefundSummary = {
  id: number;
  amount: number;
  currency: string;
  refundedAt: string;
  receivedBy: number | null;
};

export async function loadRefundSummaries(expenseId: number): Promise<RefundSummary[]> {
  const rows = await db
    .select({
      id: expenses.id,
      amount: expenses.amount,
      currency: expenses.currency,
      refundedAt: expenses.spentAt,
      receivedBy: expenseSplits.debtorId,
    })
    .from(expenses)
    .leftJoin(expenseSplits, eq(expenseSplits.expenseId, expenses.id))
    .where(and(eq(expenses.refundOfExpenseId, expenseId), eq(expenses.type, "refund")))
    .orderBy(asc(expenses.spentAt), asc(expenses.id));
  return rows.map((r) => ({ ...r, amount: n(r.amount) }));
}

/** One refund as its edit form reads it, with the expense it belongs to. */
export async function loadRefundDetail(groupId: number, refundId: number) {
  const [row] = await db
    .select()
    .from(expenses)
    .where(
      and(eq(expenses.id, refundId), eq(expenses.groupId, groupId), eq(expenses.type, "refund")),
    );
  if (!row || row.refundOfExpenseId == null) return null;
  const [parent, payers, splits, receipts] = await Promise.all([
    loadParent(db, groupId, row.refundOfExpenseId),
    db
      .select({ userId: expensePayers.payerId, amount: expensePayers.amount })
      .from(expensePayers)
      .where(eq(expensePayers.expenseId, refundId))
      .orderBy(asc(expensePayers.id)),
    db
      .select({ userId: expenseSplits.debtorId })
      .from(expenseSplits)
      .where(eq(expenseSplits.expenseId, refundId)),
    db
      .select({ fileId: expenseReceipts.fileId })
      .from(expenseReceipts)
      .where(eq(expenseReceipts.expenseId, refundId))
      .orderBy(asc(expenseReceipts.position)),
  ]);
  if (!parent) return null;
  return {
    row,
    parent,
    shares: payers.map((p) => ({ userId: p.userId, amount: n(p.amount) })),
    receivedBy: splits[0]?.userId ?? null,
    receiptFileIds: receipts.map((r) => r.fileId),
  };
}

/** The expense a new refund is recorded on, as the form needs it. */
export async function loadRefundParent(groupId: number, expenseId: number) {
  return loadParent(db, groupId, expenseId);
}
