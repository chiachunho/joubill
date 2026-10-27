import { and, eq, type SQL } from "drizzle-orm";
import { groups } from "@/db/schema";

/**
 * A group's chat is identified by the pair (`chat_type`, `chat_id`), not by a
 * Telegram-only column, so other platforms can be added later without another
 * schema change. Every lookup and every read of the id goes through here.
 *
 * Why it's shared: a query that forgets `chat_type` doesn't fail, it just
 * quietly matches the wrong group the day another platform hands out the same id.
 */
export const TELEGRAM_CHAT_TYPE = "telegram";

/** The two columns, as selected from `groups` (nullable as a pair, see the CHECK). */
export type GroupChat = { chatType: string | null; chatId: string | null };

/** The Telegram chat id of a group, or null if it isn't a Telegram group. */
export function telegramChatId(group: GroupChat): number | null {
  if (group.chatType !== TELEGRAM_CHAT_TYPE || group.chatId === null) return null;
  const id = Number(group.chatId);
  return Number.isSafeInteger(id) ? id : null;
}

/** Like `telegramChatId`, for code paths that only ever run for Telegram groups (the bot). */
export function requireTelegramChatId(group: GroupChat): number {
  const id = telegramChatId(group);
  if (id === null) {
    throw new Error(`group is not a Telegram chat (${group.chatType}:${group.chatId})`);
  }
  return id;
}

/** `WHERE chat_type = 'telegram' AND chat_id = …` — the only way to look a group up by chat. */
export function whereTelegramChat(id: number): SQL {
  return and(eq(groups.chatType, TELEGRAM_CHAT_TYPE), eq(groups.chatId, String(id)))!;
}

/** The column values to insert/set for a Telegram chat. */
export function telegramChatColumns(id: number) {
  return { chatType: TELEGRAM_CHAT_TYPE, chatId: String(id) };
}
