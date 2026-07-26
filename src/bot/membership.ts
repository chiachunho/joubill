import type { BotContext } from "./context";

/**
 * Confirm a person is actually in this Telegram chat before granting them a
 * seat at the ledger. Being *named* in a message doesn't put someone in the
 * group, and a spurious `group_members` row silently enlarges every equal
 * split, so both entry points that can seat someone from message content —
 * `/join` and `/add`'s `text_mention` handling — go through here first.
 */
export type Presence = "in" | "out" | "unknown";

export async function verifyInChat(
  api: BotContext["api"],
  chatId: number,
  telegramId: number | null,
): Promise<Presence> {
  // A user with no Telegram id (web-only OAuth account) can't be checked at all.
  if (telegramId === null) return "unknown";
  try {
    const member = await api.getChatMember(chatId, telegramId);
    return member.status === "left" || member.status === "kicked" ? "out" : "in";
  } catch {
    // Most often "user not found" for someone who was never in the chat, but a
    // transient API failure looks identical — don't claim to know which.
    return "unknown";
  }
}
