import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Message } from "grammy/types";

import { parseTopicCallback, topicCallback, topicCommand, topicOf } from "../commands/topic";
import { CHAT_ID, dbGroup, expectAllCallsStubbed, testBot } from "./harness";

const { changeNoticeThread, renameNoticeThread } = vi.hoisted(() => ({
  changeNoticeThread: vi.fn(),
  renameNoticeThread: vi.fn(),
}));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/group-notice-thread", () => ({ changeNoticeThread, renameNoticeThread }));

beforeEach(() => {
  changeNoticeThread.mockReset();
  renameNoticeThread.mockReset().mockResolvedValue(undefined);
});
afterEach(() => expectAllCallsStubbed());

const FORUM_CHAT = { id: CHAT_ID, type: "supergroup", title: "Test", is_forum: true } as const;

/** A message in topic 42 named 旅遊記帳, the way Telegram delivers one. */
function inTopic(threadId = 42, name = "旅遊記帳"): Partial<Message> {
  return {
    chat: FORUM_CHAT,
    is_topic_message: true,
    message_thread_id: threadId,
    reply_to_message: {
      message_id: threadId,
      date: 0,
      chat: FORUM_CHAT,
      forum_topic_created: { name, icon_color: 0 },
    } as Message["reply_to_message"],
  };
}

function stubReplies(t: ReturnType<typeof testBot>) {
  t.answer("answerCallbackQuery", () => true);
  t.answer("editMessageText", () => true);
}

describe("topic callback data", () => {
  it("round-trips both buttons", () => {
    const set = { kind: "set", groupId: 7, threadId: 42 } as const;
    const clear = { kind: "clear", groupId: 7 } as const;
    expect(parseTopicCallback(topicCallback(set))).toEqual(set);
    expect(parseTopicCallback(topicCallback(clear))).toEqual(clear);
  });

  it("refuses anything else", () => {
    expect(parseTopicCallback("topic:set:7")).toBeNull();
    expect(parseTopicCallback("topic:set:x:1")).toBeNull();
    expect(parseTopicCallback("topic:clear:")).toBeNull();
  });
});

describe("topicOf", () => {
  it("reads the topic and its name from the creation message", () => {
    expect(topicOf(inTopic() as Message)).toEqual({ id: 42, name: "旅遊記帳" });
  });

  it("is null in General", () => {
    expect(topicOf({ chat: FORUM_CHAT } as Message)).toBeNull();
  });

  it("knows the topic but not its name when the message replies to someone else", () => {
    const msg = {
      ...inTopic(),
      reply_to_message: {
        message_id: 99,
        date: 0,
        chat: FORUM_CHAT,
      } as Message["reply_to_message"],
    };
    expect(topicOf(msg as Message)).toEqual({ id: 42, name: null });
  });
});

describe("/topic", () => {
  it("offers the topic it was typed in", async () => {
    const t = testBot(topicCommand);
    await t.send("/topic", { extra: inTopic() });

    const [msg] = t.callsOf("sendMessage");
    expect(String(msg.text)).toContain("記帳通知發送位置");
    expect(String(msg.text)).toContain("General");
    const keyboard = JSON.stringify(msg.reply_markup);
    expect(keyboard).toContain("改發到「旅遊記帳」");
    expect(keyboard).toContain(topicCallback({ kind: "set", groupId: 7, threadId: 42 }));
    expect(keyboard).not.toContain("改回 General");
    // grammY keeps the reply in the topic the command came from.
    expect(msg.message_thread_id).toBe(42);
  });

  it("in General, shows the chosen topic and only offers to go back", async () => {
    const t = testBot(topicCommand, {
      group: dbGroup({ noticeThreadId: 42, noticeThreadName: "旅遊記帳" }),
    });
    await t.send("/topic", { extra: { chat: FORUM_CHAT } });

    const [msg] = t.callsOf("sendMessage");
    expect(String(msg.text)).toContain("# 旅遊記帳");
    expect(String(msg.text)).toContain("請到那個主題裡輸入 /topic");
    const keyboard = JSON.stringify(msg.reply_markup);
    expect(keyboard).toContain(topicCallback({ kind: "clear", groupId: 7 }));
    expect(keyboard).not.toContain("topic:set");
  });

  it("says so in a group without topics", async () => {
    const t = testBot(topicCommand);
    await t.send("/topic");
    expect(t.replies()).toEqual(["這個群組沒有開啟「主題」功能，記帳訊息都會直接發在群組裡。"]);
  });

  it("explains itself outside a group", async () => {
    const t = testBot(topicCommand, { user: undefined, group: undefined });
    await t.send("/topic");
    expect(t.replies()).toEqual(["這個指令只能在群組裡用。"]);
  });
});

describe("the buttons", () => {
  it("sets the topic the panel is in, by its name", async () => {
    changeNoticeThread.mockResolvedValue({
      ok: true,
      changed: true,
      from: null,
      to: { id: 42, name: "旅遊記帳" },
    });
    const t = testBot(topicCommand);
    stubReplies(t);
    await t.press(topicCallback({ kind: "set", groupId: 7, threadId: 42 }), { extra: inTopic() });

    expect(changeNoticeThread).toHaveBeenCalledWith(
      7,
      { id: 42, name: "旅遊記帳" },
      expect.objectContaining({ source: "bot" }),
    );
    const [edit] = t.callsOf("editMessageText");
    expect(String(edit.text)).toContain("把記帳通知改發到「旅遊記帳」");
    expect(JSON.stringify(edit.reply_markup)).toContain("改回 General");
  });

  it("refuses a set button whose topic is not the one it sits in", async () => {
    const t = testBot(topicCommand);
    stubReplies(t);
    await t.press(topicCallback({ kind: "set", groupId: 7, threadId: 43 }), { extra: inTopic() });
    expect(changeNoticeThread).not.toHaveBeenCalled();
  });

  it("refuses a button from another group", async () => {
    const t = testBot(topicCommand);
    stubReplies(t);
    await t.press(topicCallback({ kind: "clear", groupId: 8 }));
    expect(changeNoticeThread).not.toHaveBeenCalled();
  });

  it("puts it back to General", async () => {
    changeNoticeThread.mockResolvedValue({
      ok: true,
      changed: true,
      from: { id: 42, name: "旅遊記帳" },
      to: null,
    });
    const t = testBot(topicCommand);
    stubReplies(t);
    await t.press(topicCallback({ kind: "clear", groupId: 7 }), { extra: inTopic() });

    expect(changeNoticeThread).toHaveBeenCalledWith(7, null, expect.anything());
    const [edit] = t.callsOf("editMessageText");
    expect(String(edit.text)).toContain("改回發在 General");
    // Still in that topic, so the panel offers it again.
    expect(JSON.stringify(edit.reply_markup)).toContain("改發到「旅遊記帳」");
  });
});

describe("a renamed topic", () => {
  it("updates the stored name", async () => {
    const t = testBot(topicCommand);
    await t.send("", {
      extra: { ...inTopic(), text: undefined, forum_topic_edited: { name: "日本行" } },
    });
    expect(renameNoticeThread).toHaveBeenCalledWith(CHAT_ID, 42, "日本行");
  });
});
