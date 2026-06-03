import { Composer } from "grammy";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { groupDeleteRequests, groupMembers, groups } from "@/db/schema";

import type { BotContext } from "../context";

export const deleteGroupCallback = new Composer<BotContext>();

deleteGroupCallback.callbackQuery(/^approve_del:(\d+)$/, async (ctx) => {
  const requestId = Number(ctx.match[1]);
  const user = ctx.dbUser;

  if (!user) {
    await ctx.answerCallbackQuery({ text: "無法識別使用者", show_alert: true });
    return;
  }

  const [request] = await db
    .select()
    .from(groupDeleteRequests)
    .where(eq(groupDeleteRequests.id, requestId));

  if (!request) {
    await ctx.answerCallbackQuery({ text: "此申請已不存在或已處理", show_alert: true });
    await ctx.editMessageText("此刪除申請已不存在或已處理。").catch(() => null);
    return;
  }

  if (request.requestedBy === user.id) {
    await ctx.answerCallbackQuery({ text: "無法同意自己的申請", show_alert: true });
    return;
  }

  // Verify the approver is a group member
  const [membership] = await db
    .select()
    .from(groupMembers)
    .where(and(eq(groupMembers.userId, user.id), eq(groupMembers.groupId, request.groupId)));

  if (!membership) {
    await ctx.answerCallbackQuery({ text: "你不是此群組的成員", show_alert: true });
    return;
  }

  if (request.expiresAt < new Date()) {
    await db.delete(groupDeleteRequests).where(eq(groupDeleteRequests.id, requestId));
    await ctx.answerCallbackQuery({ text: "此申請已過期", show_alert: true });
    await ctx.editMessageText("刪除申請已過期。").catch(() => null);
    return;
  }

  const [group] = await db.select().from(groups).where(eq(groups.id, request.groupId));
  if (!group) {
    await ctx.answerCallbackQuery({ text: "群組不存在", show_alert: true });
    return;
  }

  const name = [user.firstName, user.lastName].filter(Boolean).join(" ") || user.username || "某人";

  await ctx.editMessageText(
    `${name} 同意刪除群組，揪帳已關閉。所有費用與結算紀錄均已清除。`,
  ).catch(() => null);

  await ctx.api.leaveChat(group.telegramChatId).catch(() => null);
  await db.delete(groups).where(eq(groups.id, request.groupId));

  await ctx.answerCallbackQuery({ text: "已同意，群組已刪除" });
});

deleteGroupCallback.callbackQuery(/^cancel_del:(\d+)$/, async (ctx) => {
  const requestId = Number(ctx.match[1]);
  const user = ctx.dbUser;

  if (!user) {
    await ctx.answerCallbackQuery({ text: "無法識別使用者", show_alert: true });
    return;
  }

  const [request] = await db
    .select()
    .from(groupDeleteRequests)
    .where(eq(groupDeleteRequests.id, requestId));

  if (!request) {
    await ctx.answerCallbackQuery({ text: "此申請已不存在或已處理", show_alert: true });
    await ctx.editMessageText("此刪除申請已不存在或已處理。").catch(() => null);
    return;
  }

  const isRequester = request.requestedBy === user.id;
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ") || user.username || "某人";
  const action = isRequester ? "取消了刪除申請" : "拒絕了刪除申請";

  await ctx.editMessageText(`${name} ${action}。`, {
    reply_markup: { inline_keyboard: [] },
  }).catch(() => null);

  await db.delete(groupDeleteRequests).where(eq(groupDeleteRequests.id, requestId));

  await ctx.answerCallbackQuery({ text: isRequester ? "已取消" : "已拒絕" });
});
