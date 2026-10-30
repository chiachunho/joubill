import { Composer } from "grammy";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { expenses, groupExchangeRates, groupMembers, groups, users } from "@/db/schema";
import { telegramChatColumns, whereTelegramChat } from "@/lib/chat";

import type { BotContext } from "../context";

/**
 * A basic group upgrading to a supergroup gets a brand-new chat id (the `-100…`
 * form). `groups.(chat_type, chat_id)` is the unique key every lookup goes through, so
 * unless we follow the rename the supergroup reads as an unrelated new group and
 * the original members / expenses are orphaned under an id nobody talks in again.
 *
 * Telegram announces the upgrade twice: `migrate_to_chat_id` on a service message
 * in the OLD chat, and `migrate_from_chat_id` on one in the NEW chat. Either is
 * enough on its own; both are handled so a single dropped update can't lose the
 * group.
 *
 * MUST be registered before registerUser — registerUser upserts a `groups` row
 * for whatever chat the update arrived from, which would create an empty
 * duplicate under the new id before we ever got the chance to rename the old one.
 */
export const chatMigration = new Composer<BotContext>();

/** `db` or a transaction handle. */
type Executor = Pick<typeof db, "select" | "insert" | "update" | "delete">;

export async function hasRecords(groupId: number, ex: Executor = db): Promise<boolean> {
  const [row] = await ex
    .select({ id: expenses.id })
    .from(expenses)
    .where(eq(expenses.groupId, groupId))
    .limit(1);
  return row !== undefined;
}

/**
 * Fold `fromId` into `intoId` and drop it. Only ever called for a group with no
 * expenses, so there are no balances to reconcile — but it may still have
 * collected members and rates, which a plain cascade delete would throw away.
 *
 * `keepSurvivorCurrency` is for `/link`, where the survivor is the real ledger (a
 * web group someone set up) and the absorbed row is the one auto-created for the
 * chat, still on the TWD default: copying its currency across would be backwards.
 * `ex` lets the caller run the whole fold inside its own transaction.
 */
export async function absorbGroup(
  fromId: number,
  intoId: number,
  { ex = db, keepSurvivorCurrency = false }: { ex?: Executor; keepSurvivorCurrency?: boolean } = {},
) {
  // Carry the configured default currency across. The surviving row is usually
  // one registerUser auto-created seconds ago, so it still holds the TWD default
  // while the absorbed row is the one someone actually set up — without this, a
  // JPY group silently reverts on upgrade and every custom rate just copied over
  // goes dormant. Only when the survivor has no records of its own: otherwise
  // its currency is what existing balances were converted against, and
  // overwriting it would restate them.
  const [from] = await ex
    .select({ defaultCurrency: groups.defaultCurrency })
    .from(groups)
    .where(eq(groups.id, fromId));
  if (!keepSurvivorCurrency && from && !(await hasRecords(intoId, ex))) {
    await ex
      .update(groups)
      .set({ defaultCurrency: from.defaultCurrency, updatedAt: new Date() })
      .where(eq(groups.id, intoId));
  }

  const members = await ex
    .select({ userId: groupMembers.userId })
    .from(groupMembers)
    .where(eq(groupMembers.groupId, fromId));

  if (members.length > 0) {
    await ex
      .insert(groupMembers)
      .values(members.map((m) => ({ groupId: intoId, userId: m.userId })))
      .onConflictDoNothing();
  }

  // Placeholder members are owned by their group (placeholder_group_id cascades),
  // so repoint them before the group row goes or they'd be deleted with it —
  // taking their payer/split rows along.
  await ex
    .update(users)
    .set({ placeholderGroupId: intoId })
    .where(eq(users.placeholderGroupId, fromId));

  const rates = await ex
    .select()
    .from(groupExchangeRates)
    .where(eq(groupExchangeRates.groupId, fromId));

  if (rates.length > 0) {
    // onConflictDoNothing keeps the surviving group's own rate for a pair it
    // already defines: its existing expenses were converted at that rate, and
    // overwriting it would silently restate settled balances.
    await ex
      .insert(groupExchangeRates)
      .values(
        rates.map((r) => ({
          groupId: intoId,
          base: r.base,
          quote: r.quote,
          rate: r.rate,
          createdBy: r.createdBy,
        })),
      )
      .onConflictDoNothing();
  }

  // group_delete_requests is deliberately not carried over — a pending deletion
  // vote against a chat id that no longer exists shouldn't outlive the merge.
  await db.delete(groups).where(eq(groups.id, fromId));
}

async function migrateGroupChatId(oldChatId: number, newChatId: number) {
  if (oldChatId === newChatId) return;

  const oldGroup = await db.query.groups.findFirst({
    where: whereTelegramChat(oldChatId),
  });
  // Nothing tracked under the old id — the upgrade doesn't concern us.
  if (!oldGroup) return;

  const newGroup = await db.query.groups.findFirst({
    where: whereTelegramChat(newChatId),
  });

  if (newGroup && newGroup.id !== oldGroup.id) {
    // A row already exists under the new id — usually one registerUser created
    // from a message that beat the migration service message. Whichever side has
    // no expenses is the disposable one; fold it into the other so the members
    // and rates it collected survive.
    const [oldHasRecords, newHasRecords] = await Promise.all([
      hasRecords(oldGroup.id),
      hasRecords(newGroup.id),
    ]);

    if (oldHasRecords && newHasRecords) {
      // Two populated ledgers need a real merge (balances, FX pins, receipts).
      // Picking one silently loses money data, so leave both and let a human decide.
      console.error(
        `[chatMigration] ${oldChatId} → ${newChatId}: groups #${oldGroup.id} and ` +
          `#${newGroup.id} both hold records; skipping migration (needs a manual merge).`,
      );
      return;
    }

    if (!oldHasRecords) {
      // The new row is the real ledger and already carries the correct chat id,
      // so there is nothing left to rename once the old one is folded in.
      await absorbGroup(oldGroup.id, newGroup.id);
      console.info(
        `[chatMigration] ${oldChatId} → ${newChatId}: merged empty group ` +
          `#${oldGroup.id} into #${newGroup.id}`,
      );
      return;
    }

    await absorbGroup(newGroup.id, oldGroup.id);
  }

  await db
    .update(groups)
    .set({ ...telegramChatColumns(newChatId), updatedAt: new Date() })
    .where(eq(groups.id, oldGroup.id));

  console.info(`[chatMigration] group #${oldGroup.id}: ${oldChatId} → ${newChatId}`);
}

// Both handlers deliberately stop the middleware chain. These are service
// messages with nothing left to handle, and letting them reach registerUser
// would re-create a `groups` row under the id we just migrated away from.

chatMigration.on("message:migrate_to_chat_id", async (ctx) => {
  await migrateGroupChatId(ctx.chat.id, ctx.message.migrate_to_chat_id);
});

chatMigration.on("message:migrate_from_chat_id", async (ctx) => {
  await migrateGroupChatId(ctx.message.migrate_from_chat_id, ctx.chat.id);
});
