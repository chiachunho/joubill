import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Api } from "grammy";

const { returning, select } = vi.hoisted(() => ({ returning: vi.fn(), select: vi.fn() }));
// Only the conditional reset touches the db: a select of the old name, then the update.
vi.mock("@/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: select }) }),
    update: () => ({ set: () => ({ where: () => ({ returning }) }) }),
  },
}));

import { chatTargetOf, isThreadGoneError, sendToGroupChat, threadExtra } from "../notice-thread";
import { threadGoneNotice, topicName } from "../topic-text";

const GONE = { error_code: 400, description: "Bad Request: message thread not found" };

function fakeApi() {
  return { sendMessage: vi.fn().mockResolvedValue({ message_id: 1 }) } as unknown as Api & {
    sendMessage: ReturnType<typeof vi.fn>;
  };
}

beforeEach(() => {
  returning.mockReset();
  select.mockReset().mockResolvedValue([{ name: "旅遊記帳" }]);
});

describe("isThreadGoneError", () => {
  it.each([
    "Bad Request: message thread not found",
    "Bad Request: TOPIC_CLOSED",
    "Bad Request: TOPIC_DELETED",
  ])("knows %s", (description) => {
    expect(isThreadGoneError({ error_code: 400, description })).toBe(true);
  });

  it("leaves every other failure to the caller", () => {
    expect(isThreadGoneError({ error_code: 403, description: "Forbidden: bot was kicked" })).toBe(
      false,
    );
    expect(isThreadGoneError({ error_code: 400, description: "Bad Request: chat not found" })).toBe(
      false,
    );
    expect(isThreadGoneError(new Error("network"))).toBe(false);
  });
});

describe("chatTargetOf / threadExtra", () => {
  it("is null for a group with no chat", () => {
    expect(chatTargetOf({ id: 1, chatType: null, chatId: null, noticeThreadId: null })).toBeNull();
  });

  it("carries the topic, and General sends no thread id", () => {
    expect(
      chatTargetOf({ id: 1, chatType: "telegram", chatId: "-100", noticeThreadId: 42 }),
    ).toEqual({ groupId: 1, chatId: -100, threadId: 42 });
    expect(threadExtra(42)).toEqual({ message_thread_id: 42 });
    expect(threadExtra(null)).toEqual({});
  });
});

describe("sendToGroupChat", () => {
  it("sends into the topic", async () => {
    const send = vi.fn().mockResolvedValue("sent");
    const result = await sendToGroupChat(
      fakeApi(),
      { groupId: 1, chatId: -100, threadId: 42 },
      send,
    );
    expect(result).toBe("sent");
    expect(send).toHaveBeenCalledExactlyOnceWith({ message_thread_id: 42 });
  });

  it("falls back to General, clears the setting and says so once, when the topic is gone", async () => {
    returning.mockResolvedValue([{ id: 1 }]);
    const api = fakeApi();
    const send = vi.fn().mockRejectedValueOnce(GONE).mockResolvedValueOnce("sent");

    const result = await sendToGroupChat(api, { groupId: 1, chatId: -100, threadId: 42 }, send);

    expect(result).toBe("sent");
    expect(send.mock.calls).toEqual([[{ message_thread_id: 42 }], [{}]]);
    expect(api.sendMessage).toHaveBeenCalledExactlyOnceWith(-100, threadGoneNotice("旅遊記帳"));
  });

  it("does not warn again when another send already cleared it", async () => {
    returning.mockResolvedValue([]);
    const api = fakeApi();
    const send = vi.fn().mockRejectedValueOnce(GONE).mockResolvedValueOnce("sent");

    await sendToGroupChat(api, { groupId: 1, chatId: -100, threadId: 42 }, send);
    expect(api.sendMessage).not.toHaveBeenCalled();
  });

  it("keeps quiet before the bot leaves: falls back to General without the warning", async () => {
    returning.mockResolvedValue([{ id: 1 }]);
    const api = fakeApi();
    const send = vi.fn().mockRejectedValueOnce(GONE).mockResolvedValueOnce("sent");

    const result = await sendToGroupChat(api, { groupId: 1, chatId: -100, threadId: 42 }, send, {
      lastMessage: true,
    });

    expect(result).toBe("sent");
    expect(send.mock.calls).toEqual([[{ message_thread_id: 42 }], [{}]]);
    expect(returning).not.toHaveBeenCalled();
    expect(api.sendMessage).not.toHaveBeenCalled();
  });

  it("rethrows any other error without retrying", async () => {
    const send = vi.fn().mockRejectedValue({ error_code: 403, description: "Forbidden" });
    await expect(
      sendToGroupChat(fakeApi(), { groupId: 1, chatId: -100, threadId: 42 }, send),
    ).rejects.toMatchObject({ error_code: 403 });
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe("topicName", () => {
  it("labels a topic whose name was never seen", () => {
    expect(topicName(null)).toBe("未命名的主題");
    expect(topicName("旅遊記帳")).toBe("旅遊記帳");
  });
});
