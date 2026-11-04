import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BTN } from "@/lib/buttons";

import { UNLINK_PROMPT_TTL_SECONDS, unlinkCommand } from "../commands/unlink";
import { dbGroup, expectAllCallsStubbed, testBot } from "./harness";

const { unlinkChat, chatTitleOf, logChatUnlinked } = vi.hoisted(() => ({
  unlinkChat: vi.fn(),
  chatTitleOf: vi.fn(async (_id: number) => "日本行"),
  logChatUnlinked: vi.fn(async () => undefined),
}));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/group-chat", async (orig) => ({
  ...(await orig<typeof import("@/lib/group-chat")>()),
  unlinkChat,
  chatTitleOf,
}));
vi.mock("@/lib/record-mutation", () => ({ logChatUnlinked }));

beforeEach(() => {
  unlinkChat.mockReset();
  logChatUnlinked.mockClear();
});
afterEach(() => {
  expectAllCallsStubbed();
});

function stubReplies(t: ReturnType<typeof testBot>) {
  t.answer("answerCallbackQuery", () => true);
  t.answer("editMessageText", () => true);
  t.answer("leaveChat", () => true);
}

describe("/unlink", () => {
  it("only asks: nothing is unlinked and the bot stays until a button is pressed", async () => {
    const t = testBot(unlinkCommand);
    await t.send("/unlink");

    expect(unlinkChat).not.toHaveBeenCalled();
    expect(t.callsOf("leaveChat")).toEqual([]);
    const [prompt] = t.callsOf("sendMessage");
    expect(String(prompt.text)).toContain("「日本行」");
    const keyboard = JSON.stringify(prompt.reply_markup);
    expect(keyboard).toContain(BTN.confirmUnlink);
    expect(keyboard).toContain("unlink:yes:7");
  });

  it("explains itself in a chat that has no group", async () => {
    const t = testBot(unlinkCommand, { user: undefined, group: undefined });
    await t.send("/unlink");
    expect(t.replies()).toEqual(["這個指令只能在已綁定的群組裡使用。"]);
  });

  it("does nothing when cancelled", async () => {
    const t = testBot(unlinkCommand);
    stubReplies(t);
    await t.press("unlink:no");

    expect(unlinkChat).not.toHaveBeenCalled();
    expect(t.callsOf("leaveChat")).toEqual([]);
    expect(t.callsOf("editMessageText")[0].text).toContain("沒有解除綁定");
  });

  it("unlinks, logs who did it, turns the prompt into the farewell, then leaves", async () => {
    unlinkChat.mockResolvedValue({ ok: true, chatId: -1001234567 });
    const t = testBot(unlinkCommand);
    stubReplies(t);
    await t.press("unlink:yes:7");

    expect(unlinkChat).toHaveBeenCalledWith(7);
    expect(logChatUnlinked).toHaveBeenCalledWith(7, { userId: 1, source: "bot" }, "日本行");
    // The prompt is edited rather than a second message sent.
    expect(t.callsOf("editMessageText")[0].text).toContain("已解除與 App 的綁定");
    expect(t.callsOf("sendMessage")).toEqual([]);
    expect(t.callsOf("leaveChat")).toEqual([{ chat_id: -1001234567 }]);
  });

  it("still leaves when the farewell can't be edited in", async () => {
    unlinkChat.mockResolvedValue({ ok: true, chatId: -1001234567 });
    const t = testBot(unlinkCommand);
    stubReplies(t);
    t.answer("editMessageText", () => {
      throw new Error("message to edit not found");
    });
    await t.press("unlink:yes:7");

    expect(t.callsOf("sendMessage")[0].text).toContain("已解除與 App 的綁定");
    expect(t.callsOf("leaveChat")).toHaveLength(1);
  });

  it("refuses a prompt that names a different group", async () => {
    const t = testBot(unlinkCommand);
    stubReplies(t);
    await t.press("unlink:yes:8");

    expect(unlinkChat).not.toHaveBeenCalled();
    expect(logChatUnlinked).not.toHaveBeenCalled();
    expect(t.callsOf("leaveChat")).toEqual([]);
  });

  it("neither logs nor leaves when another member unlinked first", async () => {
    unlinkChat.mockResolvedValue({ ok: false, reason: "no_chat" });
    const t = testBot(unlinkCommand);
    stubReplies(t);
    await t.press("unlink:yes:7");

    expect(logChatUnlinked).not.toHaveBeenCalled();
    expect(t.callsOf("leaveChat")).toEqual([]);
  });

  it("ignores a prompt nobody pressed for too long", async () => {
    const t = testBot(unlinkCommand);
    stubReplies(t);
    const old = Math.floor(Date.now() / 1000) - UNLINK_PROMPT_TTL_SECONDS - 5;
    await t.press("unlink:yes:7", { messageDate: old });

    expect(unlinkChat).not.toHaveBeenCalled();
    expect(t.callsOf("leaveChat")).toEqual([]);
    expect(t.callsOf("editMessageText")[0].text).toContain("已過期");
  });

  it("answers the button and keeps the bot in the chat when the unlink itself fails", async () => {
    unlinkChat.mockRejectedValue(new Error("db down"));
    const t = testBot(unlinkCommand);
    stubReplies(t);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await t.press("unlink:yes:7");

    expect(t.callsOf("answerCallbackQuery")).toHaveLength(1);
    expect(t.callsOf("leaveChat")).toEqual([]);
    expect(logChatUnlinked).not.toHaveBeenCalled();
  });

  it("won't act on a tap it can't attribute to a user", async () => {
    const t = testBot(unlinkCommand, { user: undefined, group: dbGroup() });
    t.answer("answerCallbackQuery", () => true);
    await t.press("unlink:yes:7");

    expect(unlinkChat).not.toHaveBeenCalled();
    expect(logChatUnlinked).not.toHaveBeenCalled();
  });
});
