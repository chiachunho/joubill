import { Composer } from "grammy";
import { and, eq } from "drizzle-orm";

import { TOAST } from "@/lib/buttons";
import { db } from "@/db";
import { groupDeleteRequests, groupMembers, groups } from "@/db/schema";
import { requireTelegramChatId } from "@/lib/chat";
import { labelUser } from "@/lib/label";

import type { BotContext } from "../context";

export const deleteGroupCallback = new Composer<BotContext>();

deleteGroupCallback.callbackQuery(/^approve_del:(\d+)$/, async (ctx) => {
  const requestId = Number(ctx.match[1]);
  const user = ctx.dbUser;

  if (!user) {
    await ctx.answerCallbackQuery({ text: TOAST.unknownUser, show_alert: true });
    return;
  }

  const [request] = await db
    .select()
    .from(groupDeleteRequests)
    .where(eq(groupDeleteRequests.id, requestId));

  if (!request) {
    await ctx.answerCallbackQuery({ text: TOAST.requestGone, show_alert: true });
    await ctx.editMessageText("此刪除申請已不存在或已處理。").catch(() => null);
    return;
  }

  if (request.requestedBy === user.id) {
    await ctx.answerCallbackQuery({ text: "無法同意自己的申請", show_alert: true });
    return;
  }

  const [membership] = await db
    .select()
    .from(groupMembers)
    .where(and(eq(groupMembers.userId, user.id), eq(groupMembers.groupId, request.groupId)));

  if (!membership) {
    await ctx.answerCallbackQuery({ text: TOAST.notAMember, show_alert: true });
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

  const name = labelUser({
    displayName: user.displayName,
    firstName: user.firstName,
    lastName: user.lastName,
    username: user.username,
  });

  // Always answer the callback query — even if DB/Telegram calls below fail — so the
  // Telegram client never shows an indefinite loading spinner on the button.
  try {
    await ctx
      .editMessageText(`${name} 同意刪除群組，揪帳已關閉。所有費用與結算紀錄均已清除。`)
      .catch(() => null);

    await ctx.api.leaveChat(requireTelegramChatId(group)).catch(() => null);

    // Use .returning() to detect a race where two members both approved simultaneously.
    // Postgres DELETE is a silent no-op when the row is already gone; the empty result
    // lets us return a clean success response without double-processing.
    const [deleted] = await db
      .delete(groups)
      .where(eq(groups.id, request.groupId))
      .returning({ id: groups.id });

    if (!deleted) {
      // Group was already deleted by a concurrent approver — still a success.
      await ctx.answerCallbackQuery({ text: TOAST.groupDeleted });
      return;
    }

    await ctx.answerCallbackQuery({ text: TOAST.groupDeleted });
  } catch {
    await ctx.answerCallbackQuery({ text: TOAST.actionFailed, show_alert: true }).catch(() => null);
  }
});

deleteGroupCallback.callbackQuery(/^cancel_del:(\d+)$/, async (ctx) => {
  const requestId = Number(ctx.match[1]);
  const user = ctx.dbUser;

  if (!user) {
    await ctx.answerCallbackQuery({ text: TOAST.unknownUser, show_alert: true });
    return;
  }

  const [request] = await db
    .select()
    .from(groupDeleteRequests)
    .where(eq(groupDeleteRequests.id, requestId));

  if (!request) {
    await ctx.answerCallbackQuery({ text: TOAST.requestGone, show_alert: true });
    await ctx.editMessageText("此刪除申請已不存在或已處理。").catch(() => null);
    return;
  }

  // Any member can reject; non-members cannot (mirrors the approve_del guard).
  const [membership] = await db
    .select()
    .from(groupMembers)
    .where(and(eq(groupMembers.userId, user.id), eq(groupMembers.groupId, request.groupId)));

  if (!membership) {
    await ctx.answerCallbackQuery({ text: TOAST.notAMember, show_alert: true });
    return;
  }

  const isRequester = request.requestedBy === user.id;
  const name = labelUser({
    displayName: user.displayName,
    firstName: user.firstName,
    lastName: user.lastName,
    username: user.username,
  });
  const action = isRequester ? "取消了刪除申請" : "拒絕了刪除申請";

  try {
    await ctx
      .editMessageText(`${name} ${action}。`, {
        reply_markup: { inline_keyboard: [] },
      })
      .catch(() => null);

    await db.delete(groupDeleteRequests).where(eq(groupDeleteRequests.id, requestId));

    await ctx.answerCallbackQuery({ text: isRequester ? "已取消" : "已拒絕" });
  } catch {
    await ctx.answerCallbackQuery({ text: TOAST.actionFailed, show_alert: true }).catch(() => null);
  }
});
