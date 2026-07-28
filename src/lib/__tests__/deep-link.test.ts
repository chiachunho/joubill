import { describe, expect, it } from "vitest";

import {
  expenseLink,
  groupLink,
  parseStartParam,
  settlementLink,
} from "@/lib/deep-link";

const BOT = "splitbill_bot";
/** Group chat ids are negative — the most common way a naive pattern breaks. */
const CHAT = -1001234567890;

/** The half of the URL that matters: what Telegram hands back as start_param. */
function startParamOf(url: string): string {
  return new URL(url).searchParams.get("startapp")!;
}

describe("builders", () => {
  it("point at the configured bot and app", () => {
    // TELEGRAM_MINI_APP_NAME is injected as "splitbill_test" by the vitest config.
    expect(groupLink(BOT, CHAT)).toBe(
      `https://t.me/${BOT}/splitbill_test?startapp=group_${CHAT}`,
    );
  });

  it("tag a record with its kind", () => {
    expect(startParamOf(expenseLink(BOT, CHAT, 42))).toBe(`group_${CHAT}_exp_42`);
    expect(startParamOf(settlementLink(BOT, CHAT, 42))).toBe(`group_${CHAT}_stl_42`);
  });
});

describe("round trip", () => {
  it("parses back what groupLink builds", () => {
    expect(parseStartParam(startParamOf(groupLink(BOT, CHAT)))).toEqual({
      telegramChatId: CHAT,
    });
  });

  it("parses back what expenseLink builds", () => {
    expect(parseStartParam(startParamOf(expenseLink(BOT, CHAT, 7)))).toEqual({
      telegramChatId: CHAT,
      record: { kind: "expense", id: 7 },
    });
  });

  it("parses back what settlementLink builds", () => {
    expect(parseStartParam(startParamOf(settlementLink(BOT, CHAT, 7)))).toEqual({
      telegramChatId: CHAT,
      record: { kind: "settlement", id: 7 },
    });
  });

  it("survives a positive chat id too", () => {
    expect(parseStartParam(startParamOf(groupLink(BOT, 555)))).toEqual({ telegramChatId: 555 });
  });
});

describe("parseStartParam rejects what it should", () => {
  it.each([
    ["", "empty"],
    [null, "null"],
    [undefined, "undefined"],
    ["group_", "no chat id"],
    ["group_abc", "non-numeric chat id"],
    ["group_123_exp_", "no record id"],
    ["group_123_xyz_4", "unknown record kind"],
    ["group_123_exp_4_extra", "trailing junk"],
    ["nonsense", "unrelated payload"],
    ["123", "bare number"],
  ])("returns null for %j (%s)", (raw: string | null | undefined, _why: string) => {
    expect(parseStartParam(raw)).toBeNull();
  });

  it("does not treat a group-only link as a record link", () => {
    expect(parseStartParam(`group_${CHAT}`)?.record).toBeUndefined();
  });
});
