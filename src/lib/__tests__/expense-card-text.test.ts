import { describe, expect, it } from "vitest";

import { cardBody, type CardPerson, type ExpenseCardInput } from "@/lib/expense-card-text";

const person = (id: number, firstName: string, telegramId: number | null = null): CardPerson => ({
  id,
  displayName: null,
  firstName,
  lastName: null,
  username: null,
  telegramId,
});
const ming = person(1, "小明");
const hua = person(2, "阿華");
const amy = person(3, "Amy");
const bob = person(4, "Bob");

function expense(over: Partial<ExpenseCardInput> = {}): ExpenseCardInput {
  return {
    description: "晚餐",
    amount: 600,
    currency: "TWD",
    converted: null,
    payers: [{ user: ming, amount: 600 }],
    splits: [
      { user: ming, amount: 200, weight: 1 },
      { user: hua, amount: 200, weight: 1 },
      { user: amy, amount: 200, weight: 1 },
    ],
    ...over,
  };
}

describe("cardBody", () => {
  it("says what, who paid and how much on one line, then one person per line", () => {
    expect(cardBody(expense())).toEqual([
      "<b>晚餐</b>　小明 付 <b>600 TWD</b>",
      "・小明 200",
      "・阿華 200",
      "・Amy 200",
    ]);
  });

  it("leaves the description out when there is none", () => {
    expect(cardBody(expense({ description: null }))[0]).toBe("小明 付 <b>600 TWD</b>");
  });

  it("puts the conversion on the headline", () => {
    const [headline] = cardBody(
      expense({ amount: 3000, currency: "JPY", converted: { amount: 612, currency: "TWD" } }),
    );
    expect(headline).toBe("<b>晚餐</b>　小明 付 <b>3,000 JPY</b>（≈ 612 TWD）");
  });

  it("shows a share weight next to the person who has it", () => {
    const lines = cardBody(
      expense({
        splits: [
          { user: ming, amount: 300, weight: 2 },
          { user: hua, amount: 150, weight: 1 },
          { user: amy, amount: 150, weight: 1 },
        ],
      }),
    );
    expect(lines.slice(1)).toEqual(["・小明 ×2 300", "・阿華 150", "・Amy 150"]);
  });

  it("with several payers, says on each line what that person paid and owes", () => {
    const lines = cardBody(
      expense({
        description: "住宿",
        amount: 5000,
        payers: [
          { user: ming, amount: 3000 },
          { user: hua, amount: 2000 },
        ],
        splits: [ming, hua, amy, bob].map((user) => ({ user, amount: 1250, weight: 1 })),
      }),
    );
    expect(lines).toEqual([
      "<b>住宿</b>　小明、阿華 付 <b>5,000 TWD</b>",
      "・小明 付 3,000，分 1,250",
      "・阿華 付 2,000，分 1,250",
      "・Amy 分 1,250",
      "・Bob 分 1,250",
    ]);
  });

  it("keeps a payer who has no share", () => {
    const lines = cardBody(
      expense({
        payers: [
          { user: ming, amount: 300 },
          { user: hua, amount: 300 },
        ],
        splits: [{ user: amy, amount: 600, weight: 1 }],
      }),
    );
    expect(lines.slice(1)).toEqual(["・小明 付 300", "・阿華 付 300", "・Amy 分 600"]);
  });

  it("makes a Telegram user tappable and escapes names and descriptions", () => {
    const lines = cardBody(
      expense({
        description: "<b>x</b>",
        payers: [{ user: person(9, "<i>", 99), amount: 600 }],
        splits: [{ user: person(9, "<i>", 99), amount: 600, weight: 1 }],
      }),
    );
    expect(lines[0]).toBe(
      '<b>&lt;b&gt;x&lt;/b&gt;</b>　<a href="tg://user?id=99">&lt;i&gt;</a> 付 <b>600 TWD</b>',
    );
  });

  it("says so when nobody splits", () => {
    expect(cardBody(expense({ splits: [] })).slice(1)).toEqual(["（沒有人分帳）"]);
  });
});
