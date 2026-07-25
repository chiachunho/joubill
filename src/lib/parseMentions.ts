import type { MessageEntity, User as TelegramUser } from "grammy/types";

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
 * The counter-intuitive result is that mentioning is reliable for users without
 * a username and best-effort for users with one.
 */
export interface ParsedMentions {
  /** Fully identified users — safe to upsert directly. */
  users: TelegramUser[];
  /** Bare handles, lowercased, `@` stripped. Only resolvable against users we already know. */
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
