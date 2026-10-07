import { describe, expect, it } from "vitest";

import { telegramChatIdOf, telegramMessageIdOf } from "@/lib/platform";

/** Supergroup ids are negative and 13 digits — the shape a naive parse breaks on. */
const CHAT = -1001234567890;

describe("telegramChatIdOf", () => {
  it("round-trips a Telegram chat id through its stored text form", () => {
    expect(telegramChatIdOf({ platform: "telegram", externalChatId: String(CHAT) })).toBe(CHAT);
  });

  it("returns null for a group on another platform", () => {
    expect(
      telegramChatIdOf({ platform: "discord", externalChatId: "1234567890123456789" }),
    ).toBeNull();
  });

  it("refuses a value that would lose precision instead of returning a wrong id", () => {
    expect(
      telegramChatIdOf({ platform: "telegram", externalChatId: "1234567890123456789" }),
    ).toBeNull();
  });

  it("refuses non-numeric text", () => {
    expect(telegramChatIdOf({ platform: "telegram", externalChatId: "" })).toBeNull();
    expect(telegramChatIdOf({ platform: "telegram", externalChatId: "12abc" })).toBeNull();
  });
});

describe("telegramMessageIdOf", () => {
  it("parses a stored message id", () => {
    expect(telegramMessageIdOf("4821")).toBe(4821);
  });

  it("treats NULL and garbage alike as no message", () => {
    expect(telegramMessageIdOf(null)).toBeNull();
    expect(telegramMessageIdOf("abc")).toBeNull();
  });
});
