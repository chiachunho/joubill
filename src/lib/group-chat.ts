import { type Api } from "grammy";
import { and, desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { expenses, groups, recordAuditLog } from "@/db/schema";
import { noChatColumns } from "@/lib/chat";
import { chatTargetOf, sendToGroupChat, type ChatTarget } from "@/lib/notice-thread";
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

/** `target` is the chat as it was, topic included, so the farewell goes where the group read. */
export type UnlinkOutcome = { ok: true; target: ChatTarget } | { ok: false; reason: "no_chat" };

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
    const target = group ? chatTargetOf(group) : null;
    const plan = planUnlink({ hasChat: target !== null });
    if (!plan.ok || target === null)
      return { ok: false, reason: plan.ok ? "no_chat" : plan.reason };

    await tx
      .update(groups)
      .set({ ...noChatColumns(), updatedAt: new Date() })
      .where(eq(groups.id, groupId));
    await tx.update(expenses).set({ noticeMessageId: null }).where(eq(expenses.groupId, groupId));
    return { ok: true, target } as const;
  });
}

export const UNLINK_FAREWELL =
  "已解除綁定，bot 離開了 👋\n" + "要重新綁定：加回 bot 後打 /link 邀請碼";

/**
 * Says goodbye in the old chat, then leaves it. Both are best effort: a kicked bot or a chat
 * that no longer exists must not undo an unlink that already committed. `farewell` is given when
 * the caller has a message of its own to edit (the bot's confirmation prompt) and returns true
 * once the text is in place, so no second message is sent.
 */
export async function leaveUnlinkedChat(
  api: Api,
  target: ChatTarget,
  farewell?: () => Promise<boolean>,
): Promise<void> {
  let said = false;
  if (farewell) said = await farewell().catch(() => false);
  const { chatId } = target;
  if (!said) {
    await sendToGroupChat(
      api,
      target,
      (thread) => api.sendMessage(chatId, UNLINK_FAREWELL, thread),
      { lastMessage: true },
    ).catch(() => null);
  }
  await api.leaveChat(chatId).catch((err) => {
    console.error(`[unlink] could not leave chat ${chatId}:`, err);
  });
}
