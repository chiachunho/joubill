import { describe, expect, it } from "vitest";
import type { MessageEntity } from "grammy/types";

import { parseAddMessage } from "../parseAdd";

/** Build a `mention` entity covering the @handle at `offset`. */
function mention(text: string, handle: string): MessageEntity {
  const offset = text.indexOf("@" + handle);
  return { type: "mention", offset, length: handle.length + 1 };
}

describe("parseAddMessage", () => {
  it("parses amount + description with no mentions", () => {
    const result = parseAddMessage("/add 300 午餐");
    expect(result.amount).toBe(300);
    expect(result.description).toBe("午餐");
    expect(result.mentionUsernames).toEqual([]);
    expect(result.mentionTelegramIds).toEqual([]);
  });

  it("parses amount only (no description)", () => {
    const result = parseAddMessage("/add 50");
    expect(result.amount).toBe(50);
    expect(result.description).toBeNull();
  });

  it("supports decimals", () => {
    expect(parseAddMessage("/add 99.99 coffee").amount).toBeCloseTo(99.99, 2);
  });

  it("collects @mentions and strips them from the description", () => {
    const text = "/add 600 晚餐 @alice @bob";
    const entities = [mention(text, "alice"), mention(text, "bob")];
    const result = parseAddMessage(text, entities);
    expect(result.amount).toBe(600);
    expect(result.description).toBe("晚餐");
    expect(result.mentionUsernames).toEqual(["alice", "bob"]);
  });

  it("lowercases mentioned usernames", () => {
    const text = "/add 100 @Alice";
    const result = parseAddMessage(text, [mention(text, "Alice")]);
    expect(result.mentionUsernames).toEqual(["alice"]);
  });

  it("reads text_mention entities (users without a username) by telegram id", () => {
    const text = "/add 100 gift Bob";
    const offset = text.indexOf("Bob");
    const entities: MessageEntity[] = [
      {
        type: "text_mention",
        offset,
        length: 3,
        user: { id: 4242, is_bot: false, first_name: "Bob" },
      },
    ];
    const result = parseAddMessage(text, entities);
    expect(result.mentionTelegramIds).toEqual([4242]);
    // "Bob" was a mention span, so it's stripped from the description.
    expect(result.description).toBe("gift");
  });

  it("handles the /add@botname form", () => {
    expect(parseAddMessage("/add@splitbill_bot 200 lunch").amount).toBe(200);
  });

  it("throws on missing amount", () => {
    expect(() => parseAddMessage("/add")).toThrow();
    expect(() => parseAddMessage("/add 午餐")).toThrow();
  });

  it("throws on non-positive amount", () => {
    expect(() => parseAddMessage("/add 0 lunch")).toThrow();
    expect(() => parseAddMessage("/add -5 lunch")).toThrow();
  });
});
