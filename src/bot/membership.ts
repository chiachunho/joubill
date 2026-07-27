import type { BotContext } from "./context";

/**
 * Confirm a person is actually in this Telegram chat before granting them a
 * seat at the ledger. Being *named* in a message doesn't put someone in the
 * group, and a spurious `group_members` row silently enlarges every equal
 * split, so both entry points that can seat someone from message content —
 * `/join` and `/add`'s `text_mention` handling — go through here first.
 */
export type Presence = "in" | "out" | "unknown";

/**
 * Whether `getChatMember`'s answer about *other* people can be trusted here.
 *
 * The Bot API only guarantees `getChatMember` "for other users if the bot is an
 * administrator in the chat" — and a non-admin bot doesn't fail loudly, it can
 * report `left` for someone who is really a member. That's a confident wrong
 * answer, not an error, so it can't be told apart at the call site. Callers that
 * would *refuse* an action on a negative result must gate on this first;
 * otherwise a non-admin bot silently rejects legitimate group members.
 *
 * Deployment treats admin rights as optional (see docs/DEPLOYMENT.md), so this
 * is the normal case, not an edge case.
 */
export async function canVerifyMembership(
  api: BotContext["api"],
  chatId: number,
  botId: number,
): Promise<boolean> {
  try {
    const me = await api.getChatMember(chatId, botId);
    return me.status === "administrator" || me.status === "creator";
  } catch {
    return false;
  }
}

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
