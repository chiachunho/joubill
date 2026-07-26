import { Composer } from "grammy";
import type { ChatMember } from "grammy/types";

import { db } from "@/db";
import { groupMembers } from "@/db/schema";
import { upsertTelegramUser } from "@/lib/auth/upsertTelegramUser";

import type { BotContext } from "../context";
import { sendGroupWelcome } from "../commands/start";

/**
 * Whether a ChatMember status means "currently in the chat".
 * `restricted` is the subtle one: a restricted user may or may not still be a
 * member, which only `is_member` tells you.
 */
export function isPresent(member: ChatMember): boolean {
  switch (member.status) {
    case "creator":
    case "administrator":
    case "member":
      return true;
    case "restricted":
      return member.is_member;
    default:
      return false; // "left" | "kicked"
  }
}

/**
 * Register users added to a group even if they never speak.
 *
 * Telegram has no "list all members" API, so membership is built from events.
 * registerUser handles people who speak / are @mentioned; this handler covers
 * the `new_chat_members` service message emitted when someone is added to the
 * group, plus `chat_member` for the joins that message doesn't cover. The group
 * row itself is upserted by registerUser on the same update.
 *
 * None of this can backfill: an event only exists for a change that happened
 * while the bot was already in the chat, and group *creation* doesn't emit one
 * at all (the Bot API flattens the initial roster to `group_chat_created: true`
 * and drops the user list). People already present when the bot arrives have to
 * come in through the welcome button or /join.
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

/**
 * Catch member changes the two handlers above structurally cannot see: joins via
 * invite link, and anything happening while privacy mode keeps normal messages
 * from reaching us.
 *
 * Telegram only delivers `chat_member` when the bot is a group administrator AND
 * the update type is opted into explicitly — it is not in the default set, so it
 * must be listed in setWebhook's `allowed_updates` (see scripts/set-webhook.ts).
 *
 * Like the rest of this file it only ever adds: a departing member may still owe
 * money, so removals are not mirrored into `group_members`.
 */
trackMembership.on("chat_member", async (ctx, next) => {
  const group = ctx.dbGroup;
  const { old_chat_member, new_chat_member } = ctx.chatMember;
  const target = new_chat_member.user;

  if (group && !target.is_bot && !isPresent(old_chat_member) && isPresent(new_chat_member)) {
    const user = await upsertTelegramUser(target);
    await db
      .insert(groupMembers)
      .values({ groupId: group.id, userId: user.id })
      .onConflictDoNothing();
  }

  await next();
});

// When the bot itself is added to a group, send a welcome message with a
// one-tap button so existing members can register without having to speak.
trackMembership.on("my_chat_member", async (ctx, next) => {
  const chatType = ctx.chat.type;
  if (chatType !== "group" && chatType !== "supergroup") return next();

  const { old_chat_member, new_chat_member } = ctx.myChatMember;

  if (!isPresent(old_chat_member) && isPresent(new_chat_member)) {
    await sendGroupWelcome(ctx as Parameters<typeof sendGroupWelcome>[0]);
  }

  await next();
});
