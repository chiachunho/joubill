import { Composer } from "grammy";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { expenses, groups } from "@/db/schema";

import type { BotContext } from "../context";

/**
 * A basic group upgrading to a supergroup gets a brand-new chat id (the `-100…`
 * form). `groups.telegramChatId` is the unique key every lookup goes through, so
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

async function migrateGroupChatId(oldChatId: number, newChatId: number) {
  if (oldChatId === newChatId) return;

  const oldGroup = await db.query.groups.findFirst({
    where: eq(groups.telegramChatId, oldChatId),
  });
  // Nothing tracked under the old id — the upgrade doesn't concern us.
  if (!oldGroup) return;

  const newGroup = await db.query.groups.findFirst({
    where: eq(groups.telegramChatId, newChatId),
  });

  if (newGroup && newGroup.id !== oldGroup.id) {
    // A row already exists under the new id. Normally it's an empty one created
    // by registerUser after a missed migration update, so absorb it — but only
    // when it holds no records. Two populated ledgers would need a real merge
    // (balances, FX pins, receipts), and silently picking one loses money data,
    // so leave both intact and make the operator decide.
    const [record] = await db
      .select({ id: expenses.id })
      .from(expenses)
      .where(eq(expenses.groupId, newGroup.id))
      .limit(1);

    if (record) {
      console.error(
        `[chatMigration] ${oldChatId} → ${newChatId}: groups #${oldGroup.id} and ` +
          `#${newGroup.id} both hold records; skipping migration (needs a manual merge).`,
      );
      return;
    }

    // Members / rates / pending requests all cascade off groups.id.
    await db.delete(groups).where(eq(groups.id, newGroup.id));
  }

  await db
    .update(groups)
    .set({ telegramChatId: newChatId, updatedAt: new Date() })
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
