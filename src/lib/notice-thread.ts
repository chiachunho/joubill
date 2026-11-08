import type { Api } from "grammy";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { groups } from "@/db/schema";

import { telegramChatId, type GroupChat } from "./chat";
import { threadGoneNotice } from "./topic-text";

export type { NoticeThread } from "./topic-text";

/**
 * 記帳通知發送位置: which forum topic of a group's chat gets the messages that have no
 * conversation to answer — the card for a record made in the App, Web App or MCP, a CSV sent from
 * the App, the group-deletion notices. A command typed in the chat is still answered where it was
 * typed (grammY's `ctx.reply` keeps the topic), so this setting never moves a bot reply.
 *
 * Every such send goes through `sendToGroupChat`. A send that forgets the topic doesn't fail, it
 * just lands in General, which is the silent drift this module exists to stop.
 */

/** Where a group's messages go. `threadId` null is the chat's General. */
export type ChatTarget = { groupId: number; chatId: number; threadId: number | null };

/** The `send*` option that puts a message in a topic; empty for General. */
export type ThreadExtra = { message_thread_id?: number };

type GroupRow = GroupChat & { id: number; noticeThreadId: number | null };

/** The group's chat and topic, or null for a group with no Telegram chat. */
export function chatTargetOf(group: GroupRow): ChatTarget | null {
  const chatId = telegramChatId(group);
  if (chatId === null) return null;
  return { groupId: group.id, chatId, threadId: group.noticeThreadId };
}

export function threadExtra(threadId: number | null): ThreadExtra {
  return threadId === null ? {} : { message_thread_id: threadId };
}

/**
 * Whether a Bot API error means the topic can no longer be posted to: deleted, closed, or the
 * chat no longer has topics at all. Matched on the description, which is all Telegram gives.
 */
export function isThreadGoneError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const { error_code, description } = err as { error_code?: unknown; description?: unknown };
  if (error_code !== 400 || typeof description !== "string") return false;
  return /message thread not found|TOPIC_(CLOSED|DELETED|ID_INVALID)/i.test(description);
}

/**
 * Sends into the group's topic. When the topic is gone, the setting is cleared, General is told
 * once, and the message is sent to General instead, so nothing is lost and the next send does not
 * fail the same way. Any other error is the caller's, as it was before topics existed.
 *
 * `lastMessage` is for a send right before the bot leaves the chat (group deleted, unlinked): it
 * still falls back to General, but neither resets the setting nor posts the warning, whose "later
 * notices go to General, use /topic" would be wrong a moment before the bot is gone.
 *
 * Kept free of `record-mutation.ts` (changing the setting lives in `group-notice-thread.ts`):
 * `notify.ts` imports this module, and `record-mutation.ts` imports `notify.ts`.
 */
export async function sendToGroupChat<T>(
  api: Api,
  target: ChatTarget,
  send: (extra: ThreadExtra) => Promise<T>,
  { lastMessage = false }: { lastMessage?: boolean } = {},
): Promise<T> {
  if (target.threadId === null) return send({});
  try {
    return await send(threadExtra(target.threadId));
  } catch (err) {
    if (!isThreadGoneError(err)) throw err;
    if (!lastMessage) {
      await forgetGoneThread(api, { ...target, threadId: target.threadId }).catch((e) =>
        console.error("[notice-thread] could not reset a gone topic:", e),
      );
    }
    return send({});
  }
}

/**
 * Clears a topic that Telegram refused, but only if it is still the setting: two sends failing at
 * once, or a member having picked another topic meanwhile, must not post the warning twice or
 * undo the new choice.
 */
async function forgetGoneThread(api: Api, target: ChatTarget & { threadId: number }) {
  const stillChosen = and(
    eq(groups.id, target.groupId),
    eq(groups.noticeThreadId, target.threadId),
  );
  const [before] = await db
    .select({ name: groups.noticeThreadName })
    .from(groups)
    .where(stillChosen);
  const [cleared] = await db
    .update(groups)
    .set({ noticeThreadId: null, noticeThreadName: null, updatedAt: new Date() })
    .where(stillChosen)
    .returning({ id: groups.id });
  if (!cleared) return;
  await api.sendMessage(target.chatId, threadGoneNotice(before?.name ?? null)).catch(() => null);
}
