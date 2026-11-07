import { and, asc, eq } from "drizzle-orm";

import { expenseReceipts, expenses } from "@/db/schema";
import { BadRequestError, NotFoundError } from "@/lib/auth/errors";
import { logUpdated } from "@/lib/record-mutation";
import { resolveReceiptFileIds } from "@/lib/receipts";
import { MAX_RECEIPTS } from "@/lib/receipt-upload";

import { apiOf, type RecordContext } from "./types";
import { db } from "@/db";

/** How many receipts an expense has now, legacy single-file column included. */
export async function countReceipts(groupId: number, recordId: number): Promise<number> {
  const [row] = await db
    .select({ id: expenses.id, legacy: expenses.receiptFileId })
    .from(expenses)
    .where(
      and(eq(expenses.id, recordId), eq(expenses.groupId, groupId), eq(expenses.type, "expense")),
    );
  if (!row) throw new NotFoundError("expense not found");
  const rows = await db
    .select({ fileId: expenseReceipts.fileId })
    .from(expenseReceipts)
    .where(eq(expenseReceipts.expenseId, recordId));
  return resolveReceiptFileIds(
    rows.map((r) => r.fileId),
    row.legacy,
  ).length;
}

/**
 * Appends photos to an expense (at most 5 in all) without touching payers or splits. Goes
 * through `logUpdated`, so the audit row, the group message and push come with it.
 * Returns the new receipt count.
 */
export async function addReceipts(
  groupId: number,
  recordId: number,
  fileIds: string[],
  ctx: RecordContext,
): Promise<number> {
  return logUpdated(apiOf(ctx), recordId, ctx.actor, async (tx) => {
    const [row] = await tx
      .select({ id: expenses.id, legacy: expenses.receiptFileId })
      .from(expenses)
      .where(
        and(eq(expenses.id, recordId), eq(expenses.groupId, groupId), eq(expenses.type, "expense")),
      );
    if (!row) throw new NotFoundError("expense not found");

    const existing = await tx
      .select({ fileId: expenseReceipts.fileId })
      .from(expenseReceipts)
      .where(eq(expenseReceipts.expenseId, recordId))
      .orderBy(asc(expenseReceipts.position));
    const current = resolveReceiptFileIds(
      existing.map((r) => r.fileId),
      row.legacy,
    );
    if (current.length + fileIds.length > MAX_RECEIPTS) {
      throw new BadRequestError(
        `an expense holds at most ${MAX_RECEIPTS} receipts and this one has ${current.length}`,
      );
    }

    // The reader prefers `expense_receipts` over the legacy column as soon as it has a row,
    // so a bot-uploaded photo must move over first or it would vanish from view.
    if (existing.length === 0 && row.legacy) {
      await tx.update(expenses).set({ receiptFileId: null }).where(eq(expenses.id, recordId));
    }
    const all = [...current, ...fileIds];
    const fresh = existing.length === 0 ? all : fileIds;
    const start = existing.length === 0 ? 0 : current.length;
    await tx
      .insert(expenseReceipts)
      .values(fresh.map((fileId, i) => ({ expenseId: recordId, fileId, position: start + i })));
    await tx.update(expenses).set({ updatedAt: new Date() }).where(eq(expenses.id, recordId));
    return all.length;
  });
}
