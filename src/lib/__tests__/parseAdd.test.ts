import { describe, expect, it } from "vitest";
import type { MessageEntity } from "grammy/types";

import { evalAmountExpr, normalizeWidth, parseAddMessage, scanAmount } from "../parseAdd";

/** Build a `mention` entity covering the @handle at `offset`. */
function mention(text: string, handle: string): MessageEntity {
  const offset = text.indexOf("@" + handle);
  return { type: "mention", offset, length: handle.length + 1 };
}

const KNOWN = new Set(["TWD", "USD", "JPY", "EUR", "KRW", "THB"]);

describe("normalizeWidth", () => {
  it("maps full-width characters to ASCII", () => {
    expect(normalizeWidth("１，２００＋３")).toBe("1,200+3");
    expect(normalizeWidth("２×３００")).toBe("2*300");
  });

  it("preserves length so entity offsets stay valid", () => {
    const s = "/add ３００ 午餐 @alice 🍜";
    expect(normalizeWidth(s)).toHaveLength(s.length);
  });
});

describe("evalAmountExpr", () => {
  it("reads plain numbers and decimals", () => {
    expect(evalAmountExpr("300")).toBe(300);
    expect(evalAmountExpr("99.99")).toBeCloseTo(99.99, 2);
  });

  it("ignores thousands separators", () => {
    expect(evalAmountExpr("1,200")).toBe(1200);
    expect(evalAmountExpr("1,234,567")).toBe(1234567);
  });

  it("applies k / 千 / 萬 multipliers", () => {
    expect(evalAmountExpr("3k")).toBe(3000);
    expect(evalAmountExpr("1.5k")).toBe(1500);
    expect(evalAmountExpr("3千")).toBe(3000);
    expect(evalAmountExpr("1.5萬")).toBe(15000);
  });

  it("evaluates arithmetic", () => {
    expect(evalAmountExpr("150+200")).toBe(350);
    expect(evalAmountExpr("150 + 200 + 50")).toBe(400);
    expect(evalAmountExpr("(300+150)/3")).toBe(150);
    expect(evalAmountExpr("2*300")).toBe(600);
    expect(evalAmountExpr("2×300")).toBe(600);
    expect(evalAmountExpr("3k+500")).toBe(3500);
  });

  it("rounds to the cent", () => {
    expect(evalAmountExpr("1200/7")).toBe(171.43);
  });

  it("returns null on garbage", () => {
    expect(evalAmountExpr("午餐")).toBeNull();
    expect(evalAmountExpr("300+")).toBeNull();
    expect(evalAmountExpr("(300")).toBeNull();
    expect(evalAmountExpr("300/0")).toBeNull();
    expect(evalAmountExpr("")).toBeNull();
  });
});

describe("scanAmount", () => {
  const scan = (s: string) => scanAmount(s, 0, KNOWN);

  it("stops at the first space", () => {
    expect(scan("300 午餐")).toMatchObject({ value: 300, currency: null, end: 3 });
  });

  it("refuses a number glued to a word", () => {
    expect(scan("3杯咖啡")).toBeNull();
    expect(scan("3days")).toBeNull();
  });

  it("reads currency symbols before the number", () => {
    expect(scan("€50 dinner")).toMatchObject({ value: 50, currency: "EUR" });
    expect(scan("NT$500")).toMatchObject({ value: 500, currency: "TWD" });
    // $ and 元 are decoration in this bot's context — they mean "group default"
    expect(scan("$300")).toMatchObject({ value: 300, currency: null });
    expect(scan("300元")).toMatchObject({ value: 300, currency: null });
    expect(scan("3000円")).toMatchObject({ value: 3000, currency: "JPY" });
  });

  it("reads ISO codes attached to or following the number", () => {
    expect(scan("3000jpy 拉麵")).toMatchObject({ value: 3000, currency: "JPY" });
    expect(scan("3000 JPY 拉麵")).toMatchObject({ value: 3000, currency: "JPY" });
  });

  it("does not mistake a description word for a currency", () => {
    expect(scan("500 BBQ")).toMatchObject({ value: 500, currency: null, end: 3 });
  });

  it("keeps spaced-out arithmetic together but stops before the description", () => {
    const r = scan("150 + 200 午餐");
    expect(r).toMatchObject({ value: 350 });
    expect("150 + 200 午餐".slice(r!.end).trim()).toBe("午餐");
  });

  it("does not swallow a trailing hyphen that isn't an operator", () => {
    const r = scan("300 -@bob");
    expect(r).toMatchObject({ value: 300, end: 3 });
  });
});

describe("parseAddMessage", () => {
  it("parses amount + description", () => {
    const result = parseAddMessage("/add 300 午餐");
    expect(result.amount).toBe(300);
    expect(result.description).toBe("午餐");
    expect(result.currency).toBeNull();
    expect(result.mentionUsernames).toEqual([]);
    expect(result.mentionTelegramIds).toEqual([]);
  });

  it("parses amount only (no description)", () => {
    const result = parseAddMessage("/add 50");
    expect(result.amount).toBe(50);
    expect(result.description).toBeNull();
  });

  it("accepts forgiving amounts", () => {
    expect(parseAddMessage("/add 1,200 聚餐").amount).toBe(1200);
    expect(parseAddMessage("/add 300元 午餐").amount).toBe(300);
    expect(parseAddMessage("/add 3k 訂金").amount).toBe(3000);
    expect(parseAddMessage("/add 150+200 晚餐").amount).toBe(350);
    expect(parseAddMessage("/add ３００ 午餐").amount).toBe(300);
  });

  it("picks up an explicit currency", () => {
    const result = parseAddMessage("/add 3000 JPY 拉麵");
    expect(result).toMatchObject({ amount: 3000, currency: "JPY", description: "拉麵" });
  });

  it("recognises the group's own default currency", () => {
    const result = parseAddMessage("/add 500 MOP 早餐", [], { currencies: ["MOP"] });
    expect(result).toMatchObject({ amount: 500, currency: "MOP", description: "早餐" });
  });

  it("collects @mentions and strips them from the description", () => {
    const text = "/add 600 晚餐 @alice @bob";
    const entities = [mention(text, "alice"), mention(text, "bob")];
    const result = parseAddMessage(text, entities);
    expect(result.amount).toBe(600);
    expect(result.description).toBe("晚餐");
    expect(result.mentionUsernames).toEqual(["alice", "bob"]);
  });

  it("lowercases mentioned usernames", () => {
    const text = "/add 100 @Alice";
    expect(parseAddMessage(text, [mention(text, "Alice")]).mentionUsernames).toEqual(["alice"]);
  });

  it("reads text_mention entities (users without a username) by telegram id", () => {
    const text = "/add 100 gift Bob";
    const offset = text.indexOf("Bob");
    const entities: MessageEntity[] = [
      { type: "text_mention", offset, length: 3, user: { id: 4242, is_bot: false, first_name: "Bob" } },
    ];
    const result = parseAddMessage(text, entities);
    expect(result.mentionTelegramIds).toEqual([4242]);
    expect(result.description).toBe("gift");
  });

  it("keeps the description's original punctuation", () => {
    expect(parseAddMessage("/add 300 午餐，含飲料").description).toBe("午餐，含飲料");
  });

  it("handles the /add@botname form", () => {
    expect(parseAddMessage("/add@splitbill_bot 200 lunch").amount).toBe(200);
  });

  it("throws on a missing or unreadable amount", () => {
    expect(() => parseAddMessage("/add")).toThrow();
    expect(() => parseAddMessage("/add 午餐")).toThrow(/看不懂金額/);
    expect(() => parseAddMessage("/add 0 lunch")).toThrow();
    expect(() => parseAddMessage("/add -5 lunch")).toThrow();
  });

  it("points multi-line input at the 調整 buttons", () => {
    expect(() => parseAddMessage("/add 300 午餐\n@alice 200")).toThrow(/調整/);
  });

  it("ignores trailing blank lines", () => {
    expect(parseAddMessage("/add 300\n\n").amount).toBe(300);
  });
});
