import { describe, expect, it } from "vitest";

import { recordPostings, type BeancountRecord } from "@/lib/beancount";
import { summariseRecord, type RecordSnapshot } from "@/lib/record-audit";
import { formatDeletedNotice, formatRefundNotice } from "@/lib/record-notice";
import { customShares, defaultRefundDescription, ratioShares } from "@/lib/refund";
import { refundInputSchema } from "@/lib/zod";

const person = (userId: number, firstName: string) => ({
  userId,
  displayName: null,
  firstName,
  lastName: null,
  username: null,
  telegramId: null,
});

describe("ratioShares", () => {
  it("shares back in the expense's proportions and sums to the amount exactly", () => {
    const shares = ratioShares(1000, [
      { userId: 1, amount: 3666.67 },
      { userId: 2, amount: 3666.67 },
      { userId: 3, amount: 3666.66 },
    ]);
    expect(shares.reduce((s, x) => s + x.amount, 0)).toBeCloseTo(1000, 10);
    expect(shares.map((s) => s.amount).sort()).toEqual([333.33, 333.33, 333.34]);
  });

  it("is independent of currency: only the ratio counts", () => {
    const shares = ratioShares(205, [
      { userId: 1, amount: 3000 },
      { userId: 2, amount: 1000 },
    ]);
    expect(shares).toEqual([
      { userId: 1, amount: 153.75 },
      { userId: 2, amount: 51.25 },
    ]);
  });

  it("gives the same rows for the same input (ties by user id)", () => {
    const weights = [
      { userId: 7, amount: 1 },
      { userId: 3, amount: 1 },
      { userId: 5, amount: 1 },
    ];
    expect(ratioShares(0.01, weights)).toEqual([{ userId: 3, amount: 0.01 }]);
    expect(ratioShares(1, weights)).toEqual(ratioShares(1, [...weights].reverse()));
  });

  it("leaves out people with no share and returns nothing for no split", () => {
    expect(
      ratioShares(100, [
        { userId: 1, amount: 0 },
        { userId: 2, amount: 50 },
      ]),
    ).toEqual([{ userId: 2, amount: 100 }]);
    expect(ratioShares(100, [])).toEqual([]);
  });
});

describe("customShares", () => {
  it("drops zero rows and rounds to cents", () => {
    expect(
      customShares([
        { userId: 1, amount: 0 },
        { userId: 2, amount: 500.004 },
      ]),
    ).toEqual([{ userId: 2, amount: 500 }]);
  });
});

describe("refundInputSchema", () => {
  const base = { amount: 1000, currency: "JPY", receivedBy: 1 };

  it("defaults to the expense's ratio", () => {
    const parsed = refundInputSchema.parse(base);
    expect(parsed.split).toBe("ratio");
  });

  it("refuses custom shares that don't add up", () => {
    expect(
      refundInputSchema.safeParse({
        ...base,
        split: "custom",
        shares: [{ userId: 2, amount: 400 }],
      }).success,
    ).toBe(false);
    expect(
      refundInputSchema.safeParse({
        ...base,
        split: "custom",
        shares: [
          { userId: 2, amount: 500 },
          { userId: 3, amount: 500 },
        ],
      }).success,
    ).toBe(true);
  });
});

describe("defaultRefundDescription", () => {
  it("names the expense", () => {
    expect(defaultRefundDescription("藥妝")).toBe("藥妝 退稅");
    expect(defaultRefundDescription(null)).toBe("退稅");
  });
});

describe("a refund's beancount postings", () => {
  const refund: BeancountRecord = {
    id: 9,
    type: "refund",
    amount: 900,
    currency: "JPY",
    description: "藥妝 退稅",
    spentAt: "2026-11-28",
    // 小明 (1) received it all; it is shared back to 1, 2 and 3.
    payers: [
      { userId: 1, amount: 300 },
      { userId: 2, amount: 300 },
      { userId: 3, amount: 300 },
    ],
    splits: [{ userId: 1, amount: 900 }],
  };
  const accounts = { expenses: "Expenses:Trip", cash: "Assets:Cash", event: "Assets:Event" };

  it("lowers the cost and brings the cash in for the person who received it", () => {
    expect(recordPostings(refund, 1, accounts)).toEqual([
      { account: "Expenses:Trip", amount: -300 },
      { account: "Assets:Cash", amount: 900 },
      { account: "Assets:Event", amount: -600 },
    ]);
  });

  it("lowers the cost and the event account for everyone else", () => {
    expect(recordPostings(refund, 2, accounts)).toEqual([
      { account: "Expenses:Trip", amount: -300 },
      { account: "Assets:Event", amount: 300 },
    ]);
  });

  it("does not touch someone outside it", () => {
    expect(recordPostings(refund, 4, accounts)).toBeNull();
  });
});

describe("refund wording", () => {
  const record = {
    type: "refund" as const,
    amount: 1000,
    currency: "JPY",
    description: "藥妝 退稅",
    payers: [
      { user: person(1, "小明"), amount: 333.33 },
      { user: person(2, "小華"), amount: 333.34 },
    ],
    splits: [{ user: person(1, "小明"), amount: 1000 }],
  };

  it("notice names who received it and what each gets back, without an emoji", () => {
    const text = formatRefundNotice(record);
    expect(text).toContain("<b>藥妝 退稅</b>");
    expect(text).toContain("小明 收到 <b>1,000 JPY</b>");
    expect(text).toContain("・小華 333.34");
    expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it("tombstone names the refund", () => {
    const text = formatDeletedNotice({
      record,
      creator: null,
      deleter: person(2, "小華"),
    });
    expect(text).toContain("<s>藥妝 退稅　1,000 JPY</s>");
  });

  it("audit summary says who received it, and when it went with its expense", () => {
    const snap: RecordSnapshot = {
      ...record,
      spentAt: "2026-11-28",
      fxRate: null,
      fxQuote: null,
      receipts: 0,
    };
    expect(summariseRecord(snap)).toBe("1,000 JPY · 小明 收到");
    expect(summariseRecord({ ...snap, cause: "parent_deleted" })).toBe(
      "1,000 JPY · 小明 收到 · 隨支出一起刪除",
    );
  });
});
