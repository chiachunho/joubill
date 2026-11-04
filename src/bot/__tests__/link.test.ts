import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RATE_LIMITED } from "@/lib/rate-limits";

import { linkCommand } from "../commands/link";
import { expectAllCallsStubbed, resetTestDb, testBot } from "./harness";

vi.mock("@/db", async () => ({ db: (await import("./harness")).testDb.db }));
const consume = vi.fn();
vi.mock("@/lib/rate-limit", () => ({
  consumeRateLimit: (...args: unknown[]) => consume(...args),
  sweepRateLimits: async () => {},
}));
// A refused /link must stop before the code is looked up.
const findActiveInvite = vi.fn(async () => null);
vi.mock("@/lib/invites", async (orig) => ({
  ...(await orig<typeof import("@/lib/invites")>()),
  findActiveInvite: (...args: unknown[]) => findActiveInvite(...(args as [])),
}));

beforeEach(() => {
  resetTestDb();
  consume.mockReset();
  findActiveInvite.mockClear();
});
afterEach(() => {
  expectAllCallsStubbed();
});

describe("/link rate limit", () => {
  it("counts the sender and the chat before looking the code up", async () => {
    consume.mockResolvedValue({ ok: true });
    const t = testBot(linkCommand);
    await t.send("/link K7M2QX9PAB");

    const [entries] = consume.mock.calls[0] as [{ rule: { name: string } }[]];
    expect(entries.map((e) => e.rule.name)).toEqual(["link:tg", "link:chat"]);
    expect(findActiveInvite).toHaveBeenCalledTimes(1);
    expect(t.replies()).toEqual(["邀請碼無效或已失效"]);
  });

  it("refuses without a lookup, and replies only the first time, without a wait time", async () => {
    const t = testBot(linkCommand);
    consume.mockResolvedValueOnce({ ok: false, retryAfter: 600, firstRefusal: true });
    await t.send("/link K7M2QX9PAB");
    consume.mockResolvedValueOnce({ ok: false, retryAfter: 600, firstRefusal: false });
    await t.send("/link K7M2QX9PAC");

    expect(findActiveInvite).not.toHaveBeenCalled();
    expect(t.replies()).toEqual([`${RATE_LIMITED.error}。`]);
  });

  it("doesn't count a bare /link, which only shows the usage", async () => {
    const t = testBot(linkCommand);
    await t.send("/link");
    expect(consume).not.toHaveBeenCalled();
    expect(t.replies()[0]).toContain("/link 邀請碼");
  });
});
