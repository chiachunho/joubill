import { InlineKeyboard } from "grammy";

import { button } from "@/lib/buttons";
import { escapeHtml } from "@/lib/telegram-html";

/**
 * The group-deletion request in the group's chat, and what it turns into once someone
 * answers. Posted by `DELETE /api/groups/[id]` and edited by the bot's buttons
 * (`deleteGroupCallback.ts`), so the request and its outcomes are worded in one place,
 * and the callback data is built here next to the pattern that reads it.
 */

export const APPROVE_DELETE = /^approve_del:(\d+)$/;
export const REJECT_DELETE = /^cancel_del:(\d+)$/;

/** `⚠️ <b>小明 想刪除「東京旅行」</b>` with the two buttons, approval in red. */
export function deleteRequestMessage(requester: string, title: string, requestId: number) {
  return {
    text:
      `⚠️ <b>${escapeHtml(requester)} 想刪除「${escapeHtml(title)}」</b>\n` +
      "需要另一位成員同意，所有紀錄會永久清除。",
    reply_markup: new InlineKeyboard()
      .text(button("approveDeleteGroup"), `approve_del:${requestId}`)
      .text(button("rejectDeleteGroup"), `cancel_del:${requestId}`),
  };
}

export const deletedNotice = (approver: string, title: string) =>
  `🗑 「${escapeHtml(title)}」已刪除（${escapeHtml(approver)} 同意）`;

export const declinedNotice = (who: string, byRequester: boolean) =>
  `${escapeHtml(who)} ${byRequester ? "取消" : "拒絕"}了刪除`;

export const EXPIRED_NOTICE = "刪除申請已過期";
export const GONE_NOTICE = "此刪除申請已不存在或已處理";
