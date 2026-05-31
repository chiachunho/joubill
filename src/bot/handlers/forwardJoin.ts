import { Composer, InlineKeyboard } from "grammy";

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

  // Guard first: confirm the admin has a DB record before doing any writes.
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

  // Upsert after all guards pass so we don't write orphaned rows.
  const dbUser = await upsertTelegramUser(fwdUser);

  const keyboard = new InlineKeyboard();
  for (const group of adminGroups) {
    // Callback data: fwd_join:{groupId}:{dbUserId}:{telegramUserId}
    // dbUserId is the internal PK so step 2 can skip a telegramId lookup.
    keyboard.text(group.title, `fwd_join:${group.id}:${dbUser.id}:${fwdUser.id}`).row();
  }

  const name = [fwdUser.first_name, fwdUser.last_name].filter(Boolean).join(" ");
  await ctx.reply(`要把「${name}」加入哪個群組？`, { reply_markup: keyboard });
});

// Step 2: admin picks a group → verify membership then register.
forwardJoin.callbackQuery(/^fwd_join:(\d+):(\d+):(\d+)$/, async (ctx) => {
  const groupId = Number(ctx.match[1]);
  const dbUserId = Number(ctx.match[2]);
  const telegramUserId = Number(ctx.match[3]);

  // Fetch group and target user in parallel — they're independent.
  const [group, targetUser] = await Promise.all([
    db.query.groups.findFirst({ where: eq(groups.id, groupId) }),
    db.query.users.findFirst({ where: eq(users.id, dbUserId) }),
  ]);

  if (!group) {
    await ctx.answerCallbackQuery({ text: "找不到群組，請重試。" });
    return;
  }

  // targetUser is guaranteed to exist (upserted in step 1), but guard defensively.
  if (!targetUser) {
    await ctx.answerCallbackQuery({ text: "找不到使用者資料，請重試。" });
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

  await db
    .insert(groupMembers)
    .values({ groupId: group.id, userId: dbUserId })
    .onConflictDoNothing();

  const name = [targetUser.firstName, targetUser.lastName].filter(Boolean).join(" ");
  await ctx.answerCallbackQuery({ text: `✅ 已將「${name}」加入「${group.title}」！` });
  try {
    await ctx.editMessageText(`✅ 已將「${name}」加入「${group.title}」的揪帳。`);
  } catch {
    // Ignore if message was already edited (e.g. double-tap).
  }
});
