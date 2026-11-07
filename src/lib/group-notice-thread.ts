import { eq, and } from "drizzle-orm";

import { db } from "@/db";
import { groups } from "@/db/schema";

import { telegramChatId, whereTelegramChat } from "./chat";
import { noticeThreadOf, topicName, type NoticeThread } from "./topic-text";
import { logNoticeThreadChanged, type Actor } from "./record-mutation";

export type NoticeThreadChange =
  | { ok: true; changed: boolean; from: NoticeThread | null; to: NoticeThread | null }
  | { ok: false; reason: "not_found" | "no_chat" };

/**
 * Sets (or, with `null`, clears) the group's topic and logs it. The one path both the bot's
 * `/topic` buttons and the App's 改回 General take, like `changeGroupTimezone`. Choosing the topic
 * already chosen only refreshes its name and logs nothing.
 */
export async function changeNoticeThread(
  groupId: number,
  to: NoticeThread | null,
  actor: Actor,
): Promise<NoticeThreadChange> {
  const result = await db.transaction(async (tx) => {
    const [group] = await tx
      .select({
        chatType: groups.chatType,
        chatId: groups.chatId,
        noticeThreadId: groups.noticeThreadId,
        noticeThreadName: groups.noticeThreadName,
      })
      .from(groups)
      .where(eq(groups.id, groupId))
      .for("update");
    if (!group) return { ok: false, reason: "not_found" } as const;
    if (telegramChatId(group) === null) return { ok: false, reason: "no_chat" } as const;

    const from = noticeThreadOf(group);
    const changed = (from?.id ?? null) !== (to?.id ?? null);
    const renamed = !changed && to !== null && to.name !== null && to.name !== from?.name;
    if (changed || renamed) {
      await tx
        .update(groups)
        .set({
          noticeThreadId: to?.id ?? null,
          noticeThreadName: to?.name ?? null,
          updatedAt: new Date(),
        })
        .where(eq(groups.id, groupId));
    }
    return { ok: true, changed, from, to } as const;
  });

  if (result.ok && result.changed) {
    await logNoticeThreadChanged(groupId, actor, {
      from: result.from ? topicName(result.from.name) : null,
      to: result.to ? topicName(result.to.name) : null,
    });
  }
  return result;
}

/** A topic was renamed in Telegram: keep the stored name in step, if it is the chosen topic. */
export async function renameNoticeThread(
  chatId: number,
  threadId: number,
  name: string,
): Promise<void> {
  await db
    .update(groups)
    .set({ noticeThreadName: name })
    .where(and(whereTelegramChat(chatId), eq(groups.noticeThreadId, threadId)));
}
