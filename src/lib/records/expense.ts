import { and, eq } from "drizzle-orm";

import { getBot } from "@/bot";
import { db } from "@/db";
import { expensePayers, expenseReceipts, expenseSplits, expenses } from "@/db/schema";
import { NotFoundError } from "@/lib/auth/errors";
import { resolveRecordFx } from "@/lib/fx";
import { logCreated, logUpdated } from "@/lib/record-mutation";
import type { ExpenseInput } from "@/lib/zod";

import { assertUsersInGroup, replacePayersAndSplits, resolveUpdateFx } from "./shared";
import type { RecordContext } from "./types";

const apiOf = (ctx: RecordContext) => (ctx.api === undefined ? getBot().api : ctx.api);

const payerRows = (id: number, input: ExpenseInput) =>
  input.payers.map((p) => ({
    expenseId: id,
    payerId: p.payerId,
    amount: p.amount.toFixed(2),
  }));

const splitRows = (id: number, input: ExpenseInput) =>
  input.splits.map((s) => ({
    expenseId: id,
    debtorId: s.debtorId,
    amount: s.amount.toFixed(2),
    shareType: input.shareType,
    splitValue: s.splitValue != null ? String(s.splitValue) : null,
  }));

const receiptRows = (id: number, fileIds: string[]) =>
  fileIds.map((fileId, i) => ({ expenseId: id, fileId, position: i }));

/** Creates an expense from already-validated input; returns its id. */
export async function createExpense(
  groupId: number,
  input: ExpenseInput,
  ctx: RecordContext,
): Promise<{ id: number }> {
  await assertUsersInGroup(groupId, [
    ...input.payers.map((p) => p.payerId),
    ...input.splits.map((s) => s.debtorId),
  ]);
  const fx = await resolveRecordFx(groupId, input.currency, input.fxRate);

  const expense = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(expenses)
      .values({
        groupId,
        type: "expense",
        amount: input.amount.toFixed(2),
        currency: input.currency,
        description: input.description,
        spentAt: input.spentAt,
        createdBy: ctx.actor.userId,
        fxRate: fx.fxRate,
        fxQuote: fx.fxQuote,
      })
      .returning();

    const ops: Promise<unknown>[] = [
      tx.insert(expensePayers).values(payerRows(row.id, input)),
      tx.insert(expenseSplits).values(splitRows(row.id, input)),
    ];
    if (input.receiptFileIds && input.receiptFileIds.length > 0) {
      ops.push(tx.insert(expenseReceipts).values(receiptRows(row.id, input.receiptFileIds)));
    }
    await Promise.all(ops);
    return row;
  });

  await logCreated(apiOf(ctx), expense.id, ctx.actor);
  return { id: expense.id };
}

/** Replaces an expense's fields, payers, splits and (when given) receipts. */
export async function updateExpense(
  groupId: number,
  expenseId: number,
  input: ExpenseInput,
  ctx: RecordContext,
): Promise<void> {
  const [existing] = await db
    .select({ id: expenses.id, currency: expenses.currency, fxQuote: expenses.fxQuote })
    .from(expenses)
    .where(
      and(eq(expenses.id, expenseId), eq(expenses.groupId, groupId), eq(expenses.type, "expense")),
    );
  if (!existing) throw new NotFoundError("expense not found");

  await assertUsersInGroup(groupId, [
    ...input.payers.map((p) => p.payerId),
    ...input.splits.map((s) => s.debtorId),
  ]);
  const fx = await resolveUpdateFx(groupId, input, existing);

  // logUpdated snapshots the record either side of the write, logs the diff and
  // refreshes the group message. Anything that edits a record goes through it.
  await logUpdated(apiOf(ctx), expenseId, ctx.actor, async (tx) => {
    await tx
      .update(expenses)
      .set({
        amount: input.amount.toFixed(2),
        currency: input.currency,
        ...(fx && { fxRate: fx.fxRate, fxQuote: fx.fxQuote }),
        description: input.description,
        spentAt: input.spentAt,
        // When receipts are explicitly managed, also clear the legacy single-file column so
        // the GET fallback cannot resurrect a "cleared" bot-uploaded receipt.
        ...(input.receiptFileIds !== undefined && { receiptFileId: null }),
        updatedAt: new Date(),
      })
      .where(eq(expenses.id, expenseId));

    await replacePayersAndSplits(
      tx,
      expenseId,
      { values: payerRows(expenseId, input) },
      { values: splitRows(expenseId, input) },
    );

    // Replace receipts when the client explicitly sends the field ([] = clear all).
    if (input.receiptFileIds !== undefined) {
      await tx.delete(expenseReceipts).where(eq(expenseReceipts.expenseId, expenseId));
      if (input.receiptFileIds.length > 0) {
        await tx.insert(expenseReceipts).values(receiptRows(expenseId, input.receiptFileIds));
      }
    }
  });
}
