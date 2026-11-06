import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { expenses, type User } from "@/db/schema";
import { NotFoundError } from "@/lib/auth/errors";
import { logDeleted } from "@/lib/record-mutation";

import { apiOf, type RecordContext } from "./types";

/**
 * Deletes an expense or settlement. Group membership is the only gate — the
 * ledger is shared, so anyone in it can fix a mistake. `logDeleted` snapshots
 * before the row (and its message id) disappear, writes the log entry and edits
 * the group message into its tombstone.
 */
export async function deleteRecord(
  groupId: number,
  recordId: number,
  type: "expense" | "settlement",
  deleter: User,
  ctx: RecordContext,
): Promise<void> {
  const [row] = await db
    .select({ id: expenses.id })
    .from(expenses)
    .where(and(eq(expenses.id, recordId), eq(expenses.groupId, groupId), eq(expenses.type, type)));
  if (!row) throw new NotFoundError(type === "expense" ? "expense not found" : "not found");

  await logDeleted(apiOf(ctx), recordId, ctx.actor, deleter, async (tx) => {
    // expense_payers, expense_splits and expense_receipts cascade via FK.
    await tx.delete(expenses).where(and(eq(expenses.id, recordId), eq(expenses.groupId, groupId)));
  });
}
