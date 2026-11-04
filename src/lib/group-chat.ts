import { type Api } from "grammy";
import { and, desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { expenses, groups, recordAuditLog } from "@/db/schema";
import { noChatColumns, telegramChatId } from "@/lib/chat";
import { planUnlink } from "@/lib/unlink-plan";

/**
 * Detaching a group from its Telegram chat, shared by `DELETE /api/groups/[id]/chat` and the
 * bot's `/unlink` so the two entry points can't drift (the same reasoning as `record-mutation.ts`:
 * a copy that forgets the notice reset or the audit row fails silently).
 */

/** The title the chat had when it was bound, or the group's own title when it began in Telegram. */
export async function chatTitleOf(groupId: number): Promise<string> {
  const [linked] = await db
    .select({ after: recordAuditLog.after })
    .from(recordAuditLog)
    .where(and(eq(recordAuditLog.groupId, groupId), eq(recordAuditLog.action, "chat_linked")))
    .orderBy(desc(recordAuditLog.id))
    .limit(1);
  const after = linked?.after as { kind?: unknown; chatTitle?: unknown } | null | undefined;
  if (after?.kind === "chatLinked" && typeof after.chatTitle === "string" && after.chatTitle) {
    return after.chatTitle;
  }
  const [group] = await db
    .select({ title: groups.title })
    .from(groups)
    .where(eq(groups.id, groupId));
  return group?.title ?? "";
}

export type UnlinkOutcome = { ok: true; chatId: number } | { ok: false; reason: "no_chat" };

/**
 * Clears the chat and every record's pointer into it, in one transaction.
 *
 * `notice_message_id` has to go with the chat: those ids belong to the old chat's messages, and a
 * group re-linked elsewhere would otherwise try to edit messages that aren't in its new chat.
 * The group is locked first and the chat re-read under the lock, so two members unlinking at
 * once get one success and one `no_chat`.
 *
 * The caller must have checked membership.
 */
export async function unlinkChat(groupId: number): Promise<UnlinkOutcome> {
  return db.transaction(async (tx) => {
    const [group] = await tx.select().from(groups).where(eq(groups.id, groupId)).for("update");
    const chatId = group ? telegramChatId(group) : null;
    const plan = planUnlink({ hasChat: chatId !== null });
    if (!plan.ok || chatId === null)
      return { ok: false, reason: plan.ok ? "no_chat" : plan.reason };

    await tx
      .update(groups)
      .set({ ...noChatColumns(), updatedAt: new Date() })
      .where(eq(groups.id, groupId));
    await tx.update(expenses).set({ noticeMessageId: null }).where(eq(expenses.groupId, groupId));
    return { ok: true, chatId } as const;
  });
}

export const UNLINK_FAREWELL =
  "這個群組已解除與 App 的綁定，之後的紀錄不會再出現在這裡，bot 即將離開。\n" +
  "要重新綁定：把 bot 加回聊天室，再輸入 /link 邀請碼。";

/**
 * Says goodbye in the old chat, then leaves it. Both are best effort: a kicked bot or a chat
 * that no longer exists must not undo an unlink that already committed. `farewell` is given when
 * the caller has a message of its own to edit (the bot's confirmation prompt) and returns true
 * once the text is in place, so no second message is sent.
 */
export async function leaveUnlinkedChat(
  api: Api,
  chatId: number,
  farewell?: () => Promise<boolean>,
): Promise<void> {
  let said = false;
  if (farewell) said = await farewell().catch(() => false);
  if (!said) await api.sendMessage(chatId, UNLINK_FAREWELL).catch(() => null);
  await api.leaveChat(chatId).catch((err) => {
    console.error(`[unlink] could not leave chat ${chatId}:`, err);
  });
}
