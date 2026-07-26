import type { Message, MessageEntity, User as TelegramUser } from "grammy/types";

/**
 * The two ways Telegram encodes an @-mention, and why they are not
 * interchangeable:
 *
 * - `text_mention` — produced when you pick someone **without** a public
 *   username from the @ autocomplete list. Carries the whole `User` object, so
 *   the numeric id is right there and the person can be registered immediately.
 * - `mention` — produced when the target **has** a username, and is just the
 *   literal text `@handle`. The Bot API has no username → user id lookup, so a
 *   handle we have never seen before cannot be resolved to a person at all.
 *
 * Mentioning therefore identifies exactly the users who *don't* have a username,
 * and Telegram now rewrites an @-list pick into a plain `@username` for every
 * account that has one — so `text_mention` fires for almost nobody in practice.
 * Replying is the path worth telling users about (see `replyTargetUser`); this
 * function's `users` output is a free bonus for the remaining handle-less few.
 */
export interface ParsedMentions {
  /** Fully identified users — safe to upsert directly. */
  users: TelegramUser[];
  /**
   * Bare handles, lowercased, `@` stripped. Returned so callers can tell the
   * sender these did nothing — **not** to be resolved. Matching them against
   * `users.username` is a guess: that column is neither unique nor refreshed
   * until its owner next touches the bot, so a handle that has changed hands
   * would seat the wrong person.
   */
  usernames: string[];
}

/**
 * Pull both mention kinds out of a message, de-duplicated and with bots dropped.
 *
 * `selfUsername` is the bot's own handle: `/join @thebot @alice` puts `@thebot`
 * in the entity list like any other mention, and reporting it back as an unknown
 * person would be nonsense.
 */
export function parseMentions(
  text: string,
  entities: readonly MessageEntity[] = [],
  selfUsername?: string | null,
): ParsedMentions {
  const self = selfUsername?.toLowerCase();
  const byId = new Map<number, TelegramUser>();
  const handles = new Set<string>();

  for (const e of entities) {
    if (e.type === "text_mention") {
      if (!e.user || e.user.is_bot) continue;
      byId.set(e.user.id, e.user);
    } else if (e.type === "mention") {
      const slice = text.slice(e.offset, e.offset + e.length);
      if (!slice.startsWith("@")) continue;
      const handle = slice.slice(1).toLowerCase();
      if (!handle || handle === self) continue;
      handles.add(handle);
    }
  }

  // A person picked from the @ list is already fully identified; drop any bare
  // handle that names the same account so they aren't reported twice.
  for (const user of byId.values()) {
    if (user.username) handles.delete(user.username.toLowerCase());
  }

  return { users: [...byId.values()], usernames: [...handles] };
}

/**
 * The author of the message a command was sent as a reply to, when that author
 * is a real person we can register.
 *
 * This is the one identification path that works regardless of whether the
 * target has a username: `reply_to_message.from` is a full `User` object, so it
 * carries the numeric id that a bare `@handle` never can. It costs a round trip
 * of UI per person, but it is exact.
 *
 * A reply to a *forwarded* message deliberately still resolves — `from` is the
 * group member who posted it here, not the original author, and that member is
 * exactly who belongs in the ledger.
 */
export function replyTargetUser(reply: Message | undefined): TelegramUser | null {
  if (!reply) return null;
  // Posted on behalf of a channel or as an anonymous admin: there is no personal
  // account behind it (`from` is absent or the GroupAnonymousBot placeholder).
  if (reply.sender_chat) return null;
  if (!reply.from || reply.from.is_bot) return null;
  return reply.from;
}
