import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { addAwaiting } from "@/db/schema";
import { BTN } from "@/lib/buttons";

import { addCommand } from "../commands/add";
import { CHAT_ID, dbUser, expectAllCallsStubbed, resetTestDb, testBot, testDb } from "./harness";

vi.mock("@/db", async () => ({ db: (await import("./harness")).testDb.db }));

beforeEach(() => {
  resetTestDb();
});
afterEach(() => {
  expectAllCallsStubbed();
});

describe("/add", () => {
  it("points a private chat at the app instead of recording anything", async () => {
    const t = testBot(addCommand, { user: dbUser() });
    await t.send("/add 300 晚餐", { privateChat: true });

    const [sent] = t.callsOf("sendMessage");
    expect(String(sent.text)).toContain("分帳要在群組裡才有意義");
    const keyboard = sent.reply_markup as { inline_keyboard: { text: string }[][] };
    expect(keyboard.inline_keyboard[0][0].text).toBe(BTN.openApp);
    expect(testDb.inserts).toHaveLength(0);
  });

  it("asks for the expense with a reply prompt when /add comes alone", async () => {
    const t = testBot(addCommand);
    await t.send("/add");

    const [sent] = t.callsOf("sendMessage");
    expect(sent.reply_markup).toEqual({ force_reply: true, selective: true });
    expect(String(sent.text)).toContain("👇 直接回覆這則訊息");
    // Remembered, so the reply lands as a new expense (no expense id, no field).
    expect(testDb.inserts).toEqual([
      {
        table: addAwaiting,
        values: expect.objectContaining({ chatId: CHAT_ID, expenseId: null, field: null }),
      },
    ]);
  });

  it("replies to a parse failure with a one-tap retry prompt", async () => {
    const t = testBot(addCommand);
    await t.send("/add 3杯咖啡");

    const [sent] = t.callsOf("sendMessage");
    // Replies to the user's own message, so `selective` targets them.
    expect(sent.reply_to_message_id).toEqual(expect.any(Number));
    expect(sent.reply_markup).toEqual({ force_reply: true, selective: true });
    expect(String(sent.text)).toContain("👇 直接回覆這則訊息重試");
    // The prompt it remembers is the one it just sent.
    const [{ message_id: sentId }] = t.resultsOf("sendMessage") as { message_id: number }[];
    expect(testDb.inserts[0]).toMatchObject({
      table: addAwaiting,
      values: { chatId: CHAT_ID, messageId: sentId, expenseId: null },
    });
  });
});
