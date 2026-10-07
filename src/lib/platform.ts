import { and, eq } from "drizzle-orm";

import { groups } from "@/db/schema";

/**
 * Chat platforms a group can live on. A group belongs to exactly one; there is
 * no ledger shared across platforms (docs/discord-support-design.zh-TW.md).
 */
export const PLATFORMS = ["telegram", "discord"] as const;
export type Platform = (typeof PLATFORMS)[number];

type GroupRef = { platform: string; externalChatId: string };

/** WHERE clause for the group bound to a Telegram chat. */
export function telegramGroupWhere(chatId: number) {
  return and(eq(groups.platform, "telegram"), eq(groups.externalChatId, String(chatId)));
}

/**
 * The chat id to hand the Telegram Bot API, or `null` when the group lives on
 * another platform. Callers outside the Telegram bot itself (route handlers)
 * must handle `null` — that's the point of returning it rather than throwing.
 */
export function telegramChatIdOf(group: GroupRef): number | null {
  if (group.platform !== "telegram") return null;
  return parseSafeInt(group.externalChatId);
}

/**
 * Message ids are stored as text so the column can also hold a Discord
 * snowflake; Telegram's always fit in a number. Anything that doesn't parse is
 * treated as "no message", the same as NULL.
 */
export function telegramMessageIdOf(id: string | null): number | null {
  return id == null ? null : parseSafeInt(id);
}

function parseSafeInt(s: string): number | null {
  if (!/^-?\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : null;
}
