import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { addAwaiting } from "@/db/schema";
import { BTN } from "@/lib/buttons";
import { ADD_USAGE } from "@/lib/parseAdd";

import { addCommand } from "../commands/add";
import { pickCallback } from "../groupPicker";
import { memberGroups } from "../myGroups";
import {
  CHAT_ID,
  dbGroup,
  dbUser,
  expectAllCallsStubbed,
  resetTestDb,
  testBot,
  testDb,
} from "./harness";

vi.mock("@/db", async () => ({ db: (await import("./harness")).testDb.db }));
vi.mock("../myGroups", () => ({ memberGroups: vi.fn(), pickedGroup: vi.fn() }));

beforeEach(() => {
  resetTestDb();
  vi.mocked(memberGroups).mockReset();
});
afterEach(() => {
  expectAllCallsStubbed();
});

describe("/add", () => {
  it("parses a private /add first and shows the usage when it is empty", async () => {
    const t = testBot(addCommand, { user: dbUser() });
    await t.send("/add", { privateChat: true });

    expect(t.replies()).toEqual([ADD_USAGE]);
    expect(memberGroups).not.toHaveBeenCalled();
    expect(testDb.inserts).toHaveLength(0);
  });

  it("reports a private /add it can't read before asking which group", async () => {
    const t = testBot(addCommand, { user: dbUser() });
    await t.send("/add 3杯咖啡", { privateChat: true });

    expect(t.replies()[0]).toContain("看不懂金額");
    expect(memberGroups).not.toHaveBeenCalled();
  });

  it("asks which group, in reply to the command, when the sender is in several", async () => {
    vi.mocked(memberGroups).mockResolvedValue([
      dbGroup({ id: 7, title: "日本行" }),
      dbGroup({ id: 8, title: "室友" }),
    ]);
    const t = testBot(addCommand, { user: dbUser() });
    await t.send("/add 600 晚餐", { privateChat: true });

    const [sent] = t.callsOf("sendMessage");
    expect(String(sent.text)).toBe("<b>晚餐　600</b> 要記到哪個群組？");
    // The pick reads the command back off reply_to_message, so it must reply to it.
    expect(sent.reply_to_message_id).toEqual(expect.any(Number));
    expect(JSON.stringify(sent.reply_markup)).toContain(pickCallback("add", 7));
    expect(JSON.stringify(sent.reply_markup)).toContain(pickCallback("add", 8));
    expect(testDb.inserts).toHaveLength(0);
  });

  it("offers to add the bot to a group when the sender is in none", async () => {
    vi.mocked(memberGroups).mockResolvedValue([]);
    const t = testBot(addCommand, { user: dbUser() });
    await t.send("/add 600 晚餐", { privateChat: true });

    const [sent] = t.callsOf("sendMessage");
    const keyboard = sent.reply_markup as { inline_keyboard: { text: string }[][] };
    expect(keyboard.inline_keyboard[0][0].text).toBe(BTN.addToGroup);
    expect(testDb.inserts).toHaveLength(0);
  });

  it("asks for the expense with a reply prompt when /add comes alone", async () => {
    const t = testBot(addCommand);
    await t.send("/add");

    const [sent] = t.callsOf("sendMessage");
    expect(sent.reply_markup).toEqual({ force_reply: true, selective: true });
    expect(String(sent.text)).toContain("直接回覆「金額 說明」👇");
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
    expect(String(sent.text)).toContain("👇 回覆這則重打");
    // The prompt it remembers is the one it just sent.
    const [{ message_id: sentId }] = t.resultsOf("sendMessage") as { message_id: number }[];
    expect(testDb.inserts[0]).toMatchObject({
      table: addAwaiting,
      values: { chatId: CHAT_ID, messageId: sentId, expenseId: null },
    });
  });
});
