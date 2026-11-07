import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  noChatColumns,
  requireTelegramChatId,
  telegramChatColumns,
  telegramChatId,
  whereTelegramChat,
} from "../chat";

describe("telegramChatId", () => {
  it("reads a telegram chat id back as a number, including negative supergroup ids", () => {
    expect(telegramChatId({ chatType: "telegram", chatId: "-1001234567890" })).toBe(-1001234567890);
  });

  it("round-trips with telegramChatColumns", () => {
    expect(telegramChatId(telegramChatColumns(-100555))).toBe(-100555);
  });

  it("returns null for another platform even if the id looks numeric", () => {
    expect(telegramChatId({ chatType: "line", chatId: "123" })).toBeNull();
  });

  it("returns null for a group with no chat", () => {
    expect(telegramChatId({ chatType: null, chatId: null })).toBeNull();
  });

  it("returns null when the stored id is not a number", () => {
    expect(telegramChatId({ chatType: "telegram", chatId: "abc" })).toBeNull();
  });
});

describe("requireTelegramChatId", () => {
  it("returns the id for a telegram group", () => {
    expect(requireTelegramChatId({ chatType: "telegram", chatId: "42" })).toBe(42);
  });

  it("throws for a non-telegram group", () => {
    expect(() => requireTelegramChatId({ chatType: "line", chatId: "42" })).toThrow();
  });
});

describe("noChatColumns", () => {
  it("nulls both columns together, as the groups_chat_pair CHECK requires", () => {
    expect(noChatColumns()).toMatchObject({ chatType: null, chatId: null });
    expect(telegramChatId(noChatColumns())).toBeNull();
  });

  it("resets the topic setting, whose thread id belongs to the old chat", () => {
    expect(noChatColumns()).toMatchObject({ noticeThreadId: null, noticeThreadName: null });
  });
});

describe("telegramChatColumns", () => {
  it("resets the topic setting when a chat is bound", () => {
    expect(telegramChatColumns(-100555)).toMatchObject({
      noticeThreadId: null,
      noticeThreadName: null,
    });
  });
});

describe("whereTelegramChat", () => {
  it("constrains both chat_type and chat_id", () => {
    const { sql, params } = new PgDialect().sqlToQuery(whereTelegramChat(-100123));
    expect(sql).toContain('"chat_type" = $1');
    expect(sql).toContain('"chat_id" = $2');
    expect(params).toEqual(["telegram", "-100123"]);
  });
});
