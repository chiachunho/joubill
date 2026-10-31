import { eq } from "drizzle-orm";

import { db } from "@/db";
import { expenses, groups } from "@/db/schema";

/**
 * Deletes a group and everything in it. Returns false when it was already gone (two approvers
 * at once).
 *
 * A bare `DELETE FROM groups` is not enough once the group has members without an account: the
 * group cascades both to `expenses` (and on to their payer and split rows) and to the
 * placeholder `users` rows, and `expense_payers.payer_id` / `expense_splits.debtor_id` don't
 * cascade from `users`, so Postgres can check them before the other path has removed the legs
 * and the whole delete fails. Removing the records first leaves the placeholders with nothing
 * pointing at them.
 */
export async function deleteGroup(groupId: number): Promise<boolean> {
  return db.transaction(async (tx) => {
    await tx.delete(expenses).where(eq(expenses.groupId, groupId));
    const deleted = await tx
      .delete(groups)
      .where(eq(groups.id, groupId))
      .returning({ id: groups.id });
    return deleted.length > 0;
  });
}
