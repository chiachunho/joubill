import { Composer } from "grammy";

import { db } from "@/db";
import { groupMembers, groups, users } from "@/db/schema";
import { upsertTelegramUser } from "@/lib/auth/upsertTelegramUser";
import { eq } from "drizzle-orm";

import type { BotContext } from "../context";

export const forwardJoin = new Composer<BotContext>();

// Step 1: admin forwards a message from someone in a private chat with the bot.
forwardJoin.on("message:forward_origin", async (ctx, next) => {
  if (ctx.chat.type !== "private") return next();

  const origin = ctx.message.forward_origin;
  if (origin.type !== "user") {
    // hidden_user: privacy settings block the sender's identity — nothing we can do.
    await ctx.reply("對方開了「隱藏轉傳來源」，拿不到 ID，沒辦法加入。");
    return;
  }

  const fwdUser = origin.sender_user;
  if (fwdUser.is_bot) {
    await ctx.reply("不能加入 bot。");
    return;
  }

  // Upsert now so the user row exists when the callback fires.
  await upsertTelegramUser(fwdUser);

  // Show only groups the admin belongs to.
  const adminUser = ctx.dbUser;
  if (!adminUser) return next();

  const adminGroups = await db
    .select({ id: groups.id, title: groups.title })
    .from(groupMembers)
    .innerJoin(groups, eq(groupMembers.groupId, groups.id))
    .where(eq(groupMembers.userId, adminUser.id));

  if (adminGroups.length === 0) {
    await ctx.reply("你還不在任何揪帳群組裡。");
    return;
  }

  const { InlineKeyboard } = await import("grammy");
  const keyboard = new InlineKeyboard();
  for (const group of adminGroups) {
    // Callback data: fwd_join:{groupId}:{telegramUserId}
    keyboard.text(group.title, `fwd_join:${group.id}:${fwdUser.id}`).row();
  }

  const name = [fwdUser.first_name, fwdUser.last_name].filter(Boolean).join(" ");
  await ctx.reply(`要把「${name}」加入哪個群組？`, { reply_markup: keyboard });
});

// Step 2: admin picks a group → verify membership then register.
forwardJoin.callbackQuery(/^fwd_join:(\d+):(\d+)$/, async (ctx) => {
  const groupId = Number(ctx.match[1]);
  const telegramUserId = Number(ctx.match[2]);

  const group = await db.query.groups.findFirst({
    where: eq(groups.id, groupId),
  });
  if (!group) {
    await ctx.answerCallbackQuery({ text: "找不到群組，請重試。" });
    return;
  }

  let member;
  try {
    member = await ctx.api.getChatMember(group.telegramChatId, telegramUserId);
  } catch {
    await ctx.answerCallbackQuery({ text: "無法確認對方是否在群組，可能 bot 已被移除。" });
    return;
  }

  if (member.status === "left" || member.status === "kicked") {
    await ctx.answerCallbackQuery({ text: "對方不在這個 Telegram 群組裡，無法加入揪帳。" });
    return;
  }

  // Look up the already-upserted user row by telegramId.
  const targetUser = await db.query.users.findFirst({
    where: eq(users.telegramId, telegramUserId),
  });
  if (!targetUser) {
    await ctx.answerCallbackQuery({ text: "找不到使用者資料，請重試。" });
    return;
  }

  await db
    .insert(groupMembers)
    .values({ groupId: group.id, userId: targetUser.id })
    .onConflictDoNothing();

  const name = [targetUser.firstName, targetUser.lastName].filter(Boolean).join(" ");
  await ctx.answerCallbackQuery({ text: `✅ 已將「${name}」加入「${group.title}」！` });
  await ctx.editMessageText(`✅ 已將「${name}」加入「${group.title}」的揪帳。`);
});
