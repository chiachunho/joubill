import { Composer } from "grammy";

import { db } from "@/db";
import { groupMembers } from "@/db/schema";
import { upsertTelegramUser } from "@/lib/auth/upsertTelegramUser";

import type { BotContext } from "../context";

/**
 * Register users added to a group even if they never speak.
 *
 * Telegram has no "list all members" API, so membership is built from events.
 * registerUser handles people who speak / are @mentioned; this handler covers
 * the `new_chat_members` service message emitted when someone is added to the
 * group. The group row itself is upserted by registerUser on the same update.
 *
 * We intentionally do NOT remove on `left_chat_member`: a member who leaves may
 * still have an unsettled balance, so they must stay visible in balances.
 */
export const trackMembership = new Composer<BotContext>();

trackMembership.on("message:new_chat_members", async (ctx, next) => {
  const group = ctx.dbGroup;
  const newcomers = ctx.message.new_chat_members.filter((u) => !u.is_bot);
  if (group && newcomers.length > 0) {
    for (const tgUser of newcomers) {
      const user = await upsertTelegramUser(tgUser);
      await db
        .insert(groupMembers)
        .values({ groupId: group.id, userId: user.id })
        .onConflictDoNothing();
    }
  }
  await next();
});
