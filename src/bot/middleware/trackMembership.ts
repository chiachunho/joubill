import { Composer, InlineKeyboard } from "grammy";

import { db } from "@/db";
import { groupMembers } from "@/db/schema";
import { upsertTelegramUser } from "@/lib/auth/upsertTelegramUser";
import { serverEnv } from "@/lib/env";

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

// When the bot itself is added to a group, send a welcome message with a
// one-tap button so existing members can register without having to speak.
trackMembership.on("my_chat_member", async (ctx, next) => {
  const chatType = ctx.chat.type;
  if (chatType !== "group" && chatType !== "supergroup") return next();

  const { old_chat_member, new_chat_member } = ctx.myChatMember;
  const wasAbsent = old_chat_member.status === "left" || old_chat_member.status === "kicked";
  const isNowPresent =
    new_chat_member.status === "member" ||
    new_chat_member.status === "administrator" ||
    new_chat_member.status === "restricted";

  if (wasAbsent && isNowPresent) {
    const { TELEGRAM_MINI_APP_NAME } = serverEnv();
    const joinLink = `https://t.me/${ctx.me.username}/${TELEGRAM_MINI_APP_NAME}?startapp=group_${ctx.chat.id}`;
    const keyboard = new InlineKeyboard().url("加入揪帳 ✋", joinLink);
    await ctx.reply(
      "嗨！我是揪帳機器人 👋\n還沒在群組發過言的成員，點下面按鈕就能加入帳目，不需要先講話。",
      { reply_markup: keyboard },
    );
  }

  await next();
});
