import { describe, expect, it } from "vitest";
import type { MessageEntity } from "grammy/types";

import { parseAddMessage } from "../parseAdd";

/** Build a `mention` entity covering the @handle at `offset`. */
function mention(text: string, handle: string): MessageEntity {
  const offset = text.indexOf("@" + handle);
  return { type: "mention", offset, length: handle.length + 1 };
}

describe("parseAddMessage — single-line equal split", () => {
  it("parses amount + description with no mentions", () => {
    const result = parseAddMessage("/add 300 午餐");
    expect(result.amount).toBe(300);
    expect(result.description).toBe("午餐");
    expect(result.mentionUsernames).toEqual([]);
    expect(result.mentionTelegramIds).toEqual([]);
    expect(result.shareLines).toEqual([]);
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
      { type: "text_mention", offset, length: 3, user: { id: 4242, is_bot: false, first_name: "Bob" } },
    ];
    const result = parseAddMessage(text, entities);
    expect(result.mentionTelegramIds).toEqual([4242]);
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

describe("parseAddMessage — multi-line unequal split", () => {
  it("Plan A: total given, explicit shares via @username", () => {
    const text = "/add 300 午餐\n@alice 200\n@bob 100";
    const result = parseAddMessage(text);
    expect(result.amount).toBe(300);
    expect(result.description).toBe("午餐");
    expect(result.shareLines).toEqual([
      { type: "username", username: "alice", amount: 200 },
      { type: "username", username: "bob", amount: 100 },
    ]);
    expect(result.mentionUsernames).toEqual([]);
  });

  it("Plan A: total given, partial shares (remainder implied for others)", () => {
    const text = "/add 300 午餐\n@alice 200";
    const result = parseAddMessage(text);
    expect(result.amount).toBe(300);
    expect(result.shareLines).toHaveLength(1);
    expect(result.shareLines[0]).toMatchObject({ type: "username", username: "alice", amount: 200 });
  });

  it("Plan B: no total, amounts inferred from share lines", () => {
    const text = "/add 午餐\n我 150\n@alice 100\n@bob 50";
    const result = parseAddMessage(text);
    expect(result.amount).toBeNull();
    expect(result.description).toBe("午餐");
    expect(result.shareLines).toEqual([
      { type: "self", amount: 150 },
      { type: "username", username: "alice", amount: 100 },
      { type: "username", username: "bob", amount: 50 },
    ]);
  });

  it("Plan B: no description, no total", () => {
    const text = "/add\n我 200\n@alice 100";
    const result = parseAddMessage(text);
    expect(result.amount).toBeNull();
    expect(result.description).toBeNull();
    expect(result.shareLines).toHaveLength(2);
  });

  it("supports 'me' keyword in English", () => {
    const text = "/add 300\nme 150\n@alice 150";
    const result = parseAddMessage(text);
    expect(result.shareLines[0]).toEqual({ type: "self", amount: 150 });
  });

  it("lowercases @usernames in share lines", () => {
    const text = "/add 200\n@Alice 100\n@BOB 100";
    const result = parseAddMessage(text);
    expect(result.shareLines[0]).toMatchObject({ username: "alice" });
    expect(result.shareLines[1]).toMatchObject({ username: "bob" });
  });

  it("reads text_mention entity in a share line", () => {
    const text = "/add 300 午餐\nBob 200\n@alice 100";
    const bobOffset = text.indexOf("Bob");
    const entities: MessageEntity[] = [
      { type: "text_mention", offset: bobOffset, length: 3, user: { id: 7777, is_bot: false, first_name: "Bob" } },
      mention(text, "alice"),
    ];
    const result = parseAddMessage(text, entities);
    expect(result.shareLines[0]).toEqual({ type: "telegramId", telegramId: 7777, amount: 200 });
    expect(result.shareLines[1]).toMatchObject({ type: "username", username: "alice", amount: 100 });
  });

  it("skips blank lines between shares", () => {
    const text = "/add 200 飲料\n@alice 100\n\n@bob 100";
    const result = parseAddMessage(text);
    expect(result.shareLines).toHaveLength(2);
  });

  it("throws on a malformed share line", () => {
    expect(() => parseAddMessage("/add 300\nalice 200")).toThrow(/格式錯誤/);
  });

  it("throws when all lines after the first are blank (treated as single-line, no amount issue)", () => {
    // Only blank lines after the first → hasShareLines = false → treated as single-line equal split
    const result = parseAddMessage("/add 300\n\n");
    expect(result.amount).toBe(300);
    expect(result.shareLines).toEqual([]);
  });
});
