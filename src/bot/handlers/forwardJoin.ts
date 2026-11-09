import { Composer, InlineKeyboard } from "grammy";

import { db } from "@/db";
import { groupMembers, groups, users } from "@/db/schema";
import { TOAST } from "@/lib/buttons";
import { requireTelegramChatId } from "@/lib/chat";
import { upsertTelegramUser } from "@/lib/auth/upsertTelegramUser";
import { displayName } from "@/lib/profile";
import { eq } from "drizzle-orm";

import type { BotContext } from "../context";
import { escapeHtml } from "../format";
import { groupForButton, replyNoGroups } from "../groupPicker";

export const forwardJoin = new Composer<BotContext>();

// Step 1: admin forwards a message from someone in a private chat with the bot.
forwardJoin.on("message:forward_origin", async (ctx, next) => {
  if (ctx.chat.type !== "private") return next();

  const origin = ctx.message.forward_origin;
  if (origin.type !== "user") {
    // hidden_user: privacy settings block the sender's identity — nothing we can do.
    await ctx.reply("對方隱藏了轉傳來源，無法加入。請在群組回覆他的訊息打 /join。");
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
    await replyNoGroups(ctx);
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

  const name = displayName(dbUser);
  await ctx.reply(`把 <b>${escapeHtml(name)}</b> 加到哪個群組？`, {
    parse_mode: "HTML",
    reply_markup: keyboard,
  });
});

// Step 2: admin picks a group → verify membership then register.
forwardJoin.callbackQuery(/^fwd_join:(\d+):(\d+):(\d+)$/, async (ctx) => {
  const groupId = Number(ctx.match[1]);
  const dbUserId = Number(ctx.match[2]);
  const telegramUserId = Number(ctx.match[3]);

  // The presser must be in the group the button names: callback data is a string the
  // client sends, so the id alone would let anyone seat people in any group.
  const [group, targetUser] = await Promise.all([
    groupForButton(ctx, groupId),
    db.query.users.findFirst({ where: eq(users.id, dbUserId) }),
  ]);

  if (!group) {
    await ctx.answerCallbackQuery({ text: TOAST.staleButton });
    return;
  }

  // targetUser is guaranteed to exist (upserted in step 1), but guard defensively.
  if (!targetUser) {
    await ctx.answerCallbackQuery({ text: TOAST.actionFailed });
    return;
  }

  let member;
  try {
    member = await ctx.api.getChatMember(requireTelegramChatId(group), telegramUserId);
  } catch {
    await ctx.answerCallbackQuery({ text: "確認不到對方是否在群組，bot 可能已被移出" });
    return;
  }

  if (member.status === "left" || member.status === "kicked") {
    await ctx.answerCallbackQuery({ text: "對方不在這個群組" });
    return;
  }

  await db
    .insert(groupMembers)
    .values({ groupId: group.id, userId: dbUserId })
    .onConflictDoNothing();

  const name = displayName(targetUser);
  await ctx.answerCallbackQuery({ text: "已加入" });
  try {
    await ctx.editMessageText(`✅ ${name} 已加入「${group.title}」`);
  } catch {
    // Ignore if message was already edited (e.g. double-tap).
  }
});
