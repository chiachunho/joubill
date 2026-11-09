import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { User } from "@/db/schema";
import { BTN, GROUP_ONLY } from "@/lib/buttons";

import { joinCommand } from "../commands/join";
import {
  ApiFailure,
  BOT_INFO,
  dbUser,
  groupMessage,
  expectAllCallsStubbed,
  resetTestDb,
  testBot,
  testDb,
  type TgUser,
} from "./harness";

vi.mock("@/db", async () => ({ db: (await import("./harness")).testDb.db }));
// Turns the Telegram user into the users row it would upsert, with a predictable id.
vi.mock("@/lib/auth/upsertTelegramUser", () => ({
  upsertTelegramUser: vi.fn(
    async (u: { id: number; first_name: string; username?: string }): Promise<User> =>
      ({
        id: u.id - 1000,
        telegramId: u.id,
        firstName: u.first_name,
        lastName: null,
        username: u.username ?? null,
        displayName: null,
      }) as User,
  ),
}));

const BOB: TgUser = { id: 1002, first_name: "Bob", username: "bob" };

beforeEach(() => {
  resetTestDb();
});
afterEach(() => {
  expectAllCallsStubbed();
});

/** The bot is an administrator, so getChatMember about other people can be trusted. */
function asAdmin(t: ReturnType<typeof testBot>, others: Record<number, string | ApiFailure>) {
  t.answer("getChatMember", (p) => {
    if (p.user_id === BOT_INFO.id) return { status: "administrator", user: BOT_INFO };
    const status = others[Number(p.user_id)];
    return status instanceof ApiFailure ? status : { status, user: { id: p.user_id } };
  });
}

describe("/join", () => {
  it("only works in a group", async () => {
    const t = testBot(joinCommand, { user: dbUser() });
    await t.send("/join", { privateChat: true });
    expect(t.replies()).toEqual([GROUP_ONLY]);
  });

  it("explains the reply form when nobody is named", async () => {
    const t = testBot(joinCommand);
    await t.send("/join");
    expect(t.replies()[0]).toContain("<b>回覆</b>對方的訊息再打");
    expect(testDb.inserts).toHaveLength(0);
  });

  it("does not resolve a typed @handle, and offers the app instead", async () => {
    const t = testBot(joinCommand);
    await t.send("/join @carol", { entities: [{ type: "mention", offset: 6, length: 6 }] });

    expect(testDb.inserts).toHaveLength(0);
    const [sent] = t.callsOf("sendMessage");
    expect(String(sent.text)).toContain("@carol 要用<b>回覆</b>的方式加");
    const keyboard = sent.reply_markup as { inline_keyboard: { text: string }[][] };
    expect(keyboard.inline_keyboard[0][0].text).toBe(BTN.openApp);
  });

  it("does not seat whoever an anonymous admin's message came from", async () => {
    const t = testBot(joinCommand);
    await t.send("/join", {
      replyTo: { ...groupMessage(BOB), sender_chat: { id: -100, type: "supergroup", title: "x" } },
    });
    expect(testDb.inserts).toHaveLength(0);
    expect(t.replies()[0]).toContain("<b>回覆</b>");
  });

  it("seats the replied-to person when the bot can't verify membership", async () => {
    // Not an admin: getChatMember about others is unreliable, so the sender's intent wins.
    const t = testBot(joinCommand);
    t.answer("getChatMember", () => ({ status: "member", user: BOT_INFO }));
    await t.send("/join", { replyTo: groupMessage(BOB) });

    expect(testDb.inserts.map((i) => i.values)).toEqual([{ groupId: 7, userId: 2 }]);
    expect(t.replies()[0]).toContain("Bob</a> 加入了");
    // Only the bot's own status was asked about.
    expect(t.callsOf("getChatMember").map((p) => p.user_id)).toEqual([BOT_INFO.id]);
  });

  it("refuses someone an admin bot sees as having left", async () => {
    const t = testBot(joinCommand);
    asAdmin(t, { [BOB.id]: "left" });
    await t.send("/join", { replyTo: groupMessage(BOB) });

    expect(testDb.inserts).toHaveLength(0);
    expect(t.replies()[0]).toContain("Bob</a> 不在這個群組");
  });

  it("doesn't seat anyone when the membership check fails", async () => {
    // A transient failure looks the same as "never a member", so unknown does not seat.
    const t = testBot(joinCommand);
    asAdmin(t, { [BOB.id]: new ApiFailure() });
    await t.send("/join", { replyTo: groupMessage(BOB) });

    expect(testDb.inserts).toHaveLength(0);
    expect(t.replies()[0]).toContain("Bob</a> 確認不到");
  });

  it("says when the person is already a member", async () => {
    const t = testBot(joinCommand);
    asAdmin(t, { [BOB.id]: "member" });
    testDb.state.returning = []; // the conflict clause fired
    await t.send("/join", { replyTo: groupMessage(BOB) });

    expect(t.replies()[0]).toContain("Bob</a> 已經在了");
    expect(t.replies()[0]).not.toContain("加入了");
  });
});
