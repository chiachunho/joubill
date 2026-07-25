import { describe, expect, it } from "vitest";
import type { Message, MessageEntity } from "grammy/types";

import { parseMentions, replyTargetUser } from "../parseMentions";

/** Minimal Message stand-in — replyTargetUser only reads `from` / `sender_chat`. */
function replied(fields: Partial<Message>): Message {
  return fields as Message;
}

/** Build a `mention` entity covering the @handle at its position in `text`. */
function mention(text: string, handle: string): MessageEntity {
  return { type: "mention", offset: text.indexOf("@" + handle), length: handle.length + 1 };
}

/** Build a `text_mention` entity covering `name` at its position in `text`. */
function textMention(
  text: string,
  name: string,
  user: { id: number; first_name: string; username?: string },
): MessageEntity {
  return {
    type: "text_mention",
    offset: text.indexOf(name),
    length: name.length,
    user: { is_bot: false, ...user },
  };
}

describe("parseMentions", () => {
  it("returns nothing for a bare command", () => {
    expect(parseMentions("/join")).toEqual({ users: [], usernames: [] });
  });

  it("collects @handles lowercased and without the @", () => {
    const text = "/join @Alice @bob";
    const result = parseMentions(text, [mention(text, "Alice"), mention(text, "bob")]);
    expect(result.usernames).toEqual(["alice", "bob"]);
    expect(result.users).toEqual([]);
  });

  it("collects text_mention users with their telegram id", () => {
    const text = "/join Bob";
    const result = parseMentions(text, [textMention(text, "Bob", { id: 4242, first_name: "Bob" })]);
    expect(result.users).toEqual([{ id: 4242, is_bot: false, first_name: "Bob" }]);
    expect(result.usernames).toEqual([]);
  });

  it("handles both mention kinds in one message", () => {
    const text = "/join @alice Bob";
    const result = parseMentions(text, [
      mention(text, "alice"),
      textMention(text, "Bob", { id: 7, first_name: "Bob" }),
    ]);
    expect(result.usernames).toEqual(["alice"]);
    expect(result.users.map((u) => u.id)).toEqual([7]);
  });

  it("drops bots from text_mention entities", () => {
    const text = "/join Helper";
    const entity = textMention(text, "Helper", { id: 1, first_name: "Helper" });
    if (entity.type === "text_mention") entity.user.is_bot = true;
    expect(parseMentions(text, [entity]).users).toEqual([]);
  });

  it("drops the bot's own handle", () => {
    const text = "/join @mybot @alice";
    const result = parseMentions(text, [mention(text, "mybot"), mention(text, "alice")], "MyBot");
    expect(result.usernames).toEqual(["alice"]);
  });

  it("de-duplicates repeated mentions of the same person", () => {
    const text = "/join @alice @alice";
    // Both entities point at the same handle, so only one offset is findable —
    // pass the same entity twice, which is what a repeated mention reduces to.
    const e = mention(text, "alice");
    expect(parseMentions(text, [e, e]).usernames).toEqual(["alice"]);

    const t2 = "/join Bob Bob";
    const u = textMention(t2, "Bob", { id: 9, first_name: "Bob" });
    expect(parseMentions(t2, [u, u]).users).toHaveLength(1);
  });

  it("prefers the identified user when a handle names the same account", () => {
    const text = "/join @alice Alice";
    const result = parseMentions(text, [
      mention(text, "alice"),
      textMention(text, "Alice", { id: 5, first_name: "Alice", username: "Alice" }),
    ]);
    expect(result.usernames).toEqual([]);
    expect(result.users.map((u) => u.id)).toEqual([5]);
  });

  it("ignores non-mention entities", () => {
    const text = "/join @alice";
    const entities: MessageEntity[] = [
      { type: "bot_command", offset: 0, length: 5 },
      mention(text, "alice"),
    ];
    expect(parseMentions(text, entities).usernames).toEqual(["alice"]);
  });
});

describe("replyTargetUser", () => {
  const alice = { id: 42, is_bot: false, first_name: "Alice" };

  it("returns null when the command isn't a reply", () => {
    expect(replyTargetUser(undefined)).toBeNull();
  });

  it("returns the replied-to author", () => {
    expect(replyTargetUser(replied({ from: alice }))).toEqual(alice);
  });

  it("identifies users who have a username just as well", () => {
    const withHandle = { ...alice, username: "alice" };
    expect(replyTargetUser(replied({ from: withHandle }))).toEqual(withHandle);
  });

  it("returns null for a reply to a bot's message", () => {
    expect(replyTargetUser(replied({ from: { ...alice, is_bot: true } }))).toBeNull();
  });

  it("returns null for a message posted on behalf of a chat", () => {
    // Anonymous admin / channel post: `from` is the GroupAnonymousBot placeholder,
    // and there's no personal account to seat.
    const anon = replied({
      from: { id: 1087968824, is_bot: true, first_name: "Group" },
      sender_chat: { id: -100123, type: "supergroup", title: "G" } as Message["sender_chat"],
    });
    expect(replyTargetUser(anon)).toBeNull();
  });

  it("resolves a reply to a forwarded message to the member who posted it here", () => {
    const forwarded = replied({
      from: alice,
      forward_origin: {
        type: "user",
        date: 0,
        sender_user: { id: 999, is_bot: false, first_name: "Someone else" },
      },
    });
    expect(replyTargetUser(forwarded)).toEqual(alice);
  });
});
