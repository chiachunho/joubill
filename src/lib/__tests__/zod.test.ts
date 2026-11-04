import { describe, expect, it } from "vitest";

import {
  beancountConfigInputSchema,
  expenseInputSchema,
  groupCreateSchema,
  idSchema,
  isPushServiceUrl,
  pushSubscriptionSchema,
  settlementInputSchema,
} from "../zod";

const validExpense = {
  amount: 300,
  currency: "TWD" as const,
  description: "dinner",
  payers: [{ payerId: 1, amount: 300 }],
  spentAt: "2026-05-27T12:00:00.000Z",
  shareType: "equal" as const,
  splits: [
    { debtorId: 1, amount: 150 },
    { debtorId: 2, amount: 150 },
  ],
};

describe("expenseInputSchema", () => {
  it("accepts a well-formed expense", () => {
    expect(expenseInputSchema.safeParse(validExpense).success).toBe(true);
  });

  it("accepts null description", () => {
    expect(expenseInputSchema.safeParse({ ...validExpense, description: null }).success).toBe(true);
  });

  it("rejects splits that don't sum to amount", () => {
    const r = expenseInputSchema.safeParse({
      ...validExpense,
      splits: [
        { debtorId: 1, amount: 150 },
        { debtorId: 2, amount: 100 },
      ],
    });
    expect(r.success).toBe(false);
  });

  it("allows ±0.01 rounding slack in the splits sum", () => {
    const r = expenseInputSchema.safeParse({
      ...validExpense,
      amount: 100,
      payers: [{ payerId: 1, amount: 100 }],
      splits: [
        { debtorId: 1, amount: 33.34 },
        { debtorId: 2, amount: 33.33 },
        { debtorId: 3, amount: 33.33 },
      ],
    });
    expect(r.success).toBe(true);
  });

  it("rejects an unsupported currency", () => {
    expect(expenseInputSchema.safeParse({ ...validExpense, currency: "XYZ" }).success).toBe(false);
  });

  it("rejects non-positive amount", () => {
    expect(expenseInputSchema.safeParse({ ...validExpense, amount: 0 }).success).toBe(false);
  });

  it("rejects an invalid date", () => {
    expect(expenseInputSchema.safeParse({ ...validExpense, spentAt: "not-a-date" }).success).toBe(
      false,
    );
  });

  it("requires at least one split", () => {
    expect(expenseInputSchema.safeParse({ ...validExpense, splits: [] }).success).toBe(false);
  });

  it("accepts multiple payers summing to the total", () => {
    const r = expenseInputSchema.safeParse({
      ...validExpense,
      payers: [
        { payerId: 1, amount: 180 },
        { payerId: 2, amount: 120 },
      ],
    });
    expect(r.success).toBe(true);
  });

  it("rejects payers that don't sum to amount", () => {
    const r = expenseInputSchema.safeParse({
      ...validExpense,
      payers: [
        { payerId: 1, amount: 100 },
        { payerId: 2, amount: 100 },
      ],
    });
    expect(r.success).toBe(false);
  });

  it("requires at least one payer", () => {
    expect(expenseInputSchema.safeParse({ ...validExpense, payers: [] }).success).toBe(false);
  });

  it("rejects duplicate payerIds", () => {
    const r = expenseInputSchema.safeParse({
      ...validExpense,
      amount: 300,
      payers: [
        { payerId: 1, amount: 150 },
        { payerId: 1, amount: 150 },
      ],
    });
    expect(r.success).toBe(false);
  });

  it("rejects a payer with zero amount", () => {
    const r = expenseInputSchema.safeParse({
      ...validExpense,
      amount: 300,
      payers: [
        { payerId: 1, amount: 0 },
        { payerId: 2, amount: 300 },
      ],
    });
    expect(r.success).toBe(false);
  });

  it("rejects a payer with negative amount", () => {
    const r = expenseInputSchema.safeParse({
      ...validExpense,
      payers: [{ payerId: 1, amount: -300 }],
    });
    expect(r.success).toBe(false);
  });

  it("allows ±0.005 rounding slack in the payers sum", () => {
    const r = expenseInputSchema.safeParse({
      ...validExpense,
      amount: 100,
      payers: [
        { payerId: 1, amount: 33.34 },
        { payerId: 2, amount: 33.33 },
        { payerId: 3, amount: 33.33 },
      ],
      splits: [
        { debtorId: 1, amount: 33.34 },
        { debtorId: 2, amount: 33.33 },
        { debtorId: 3, amount: 33.33 },
      ],
    });
    expect(r.success).toBe(true);
  });

  it("accepts three payers summing to total", () => {
    const r = expenseInputSchema.safeParse({
      ...validExpense,
      amount: 300,
      payers: [
        { payerId: 1, amount: 100 },
        { payerId: 2, amount: 100 },
        { payerId: 3, amount: 100 },
      ],
    });
    expect(r.success).toBe(true);
  });

  it("accepts a receiptFileIds array", () => {
    expect(
      expenseInputSchema.safeParse({
        ...validExpense,
        receiptFileIds: ["AgACAgIAAx", "BgACBgIBBy"],
      }).success,
    ).toBe(true);
  });

  it("accepts missing receiptFileIds (optional)", () => {
    expect(expenseInputSchema.safeParse(validExpense).success).toBe(true);
  });

  it("rejects receiptFileIds with more than 5 entries", () => {
    expect(
      expenseInputSchema.safeParse({
        ...validExpense,
        receiptFileIds: ["a", "b", "c", "d", "e", "f"],
      }).success,
    ).toBe(false);
  });

  it("rejects a receiptFileId entry exceeding 256 chars", () => {
    expect(
      expenseInputSchema.safeParse({
        ...validExpense,
        receiptFileIds: ["x".repeat(257)],
      }).success,
    ).toBe(false);
  });

  it("accepts a positive fxRate", () => {
    expect(expenseInputSchema.safeParse({ ...validExpense, fxRate: 0.22 }).success).toBe(true);
  });

  it("accepts null and missing fxRate (optional)", () => {
    expect(expenseInputSchema.safeParse({ ...validExpense, fxRate: null }).success).toBe(true);
    expect(expenseInputSchema.safeParse(validExpense).success).toBe(true);
  });

  it("rejects a non-positive fxRate", () => {
    expect(expenseInputSchema.safeParse({ ...validExpense, fxRate: 0 }).success).toBe(false);
    expect(expenseInputSchema.safeParse({ ...validExpense, fxRate: -1 }).success).toBe(false);
  });
});

describe("settlementInputSchema", () => {
  const valid = { fromUserId: 1, toUserId: 2, amount: 50, currency: "USD" as const };

  it("accepts a valid settlement", () => {
    expect(settlementInputSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts an optional settledAt", () => {
    expect(
      settlementInputSchema.safeParse({ ...valid, settledAt: "2026-01-01T00:00:00Z" }).success,
    ).toBe(true);
  });

  it("rejects non-positive amount", () => {
    expect(settlementInputSchema.safeParse({ ...valid, amount: -1 }).success).toBe(false);
  });

  it("rejects an invalid settledAt", () => {
    expect(settlementInputSchema.safeParse({ ...valid, settledAt: "nope" }).success).toBe(false);
  });

  it("accepts a positive fxRate and null/missing fxRate (optional)", () => {
    expect(settlementInputSchema.safeParse({ ...valid, fxRate: 0.22 }).success).toBe(true);
    expect(settlementInputSchema.safeParse({ ...valid, fxRate: null }).success).toBe(true);
    expect(settlementInputSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects a non-positive fxRate", () => {
    expect(settlementInputSchema.safeParse({ ...valid, fxRate: 0 }).success).toBe(false);
  });
});

describe("beancountConfigInputSchema", () => {
  const valid = {
    expensesAccount: "Expenses:Uncategorized",
    cashAccount: "Assets:Cash",
    eventAccount: "Assets:Receivable:Japan",
  };

  it("accepts ASCII account names", () => {
    expect(beancountConfigInputSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts a Chinese account segment", () => {
    const r = beancountConfigInputSchema.safeParse({
      ...valid,
      eventAccount: "Assets:Receivable:日本旅行",
    });
    expect(r.success).toBe(true);
  });

  it("rejects a segment starting with punctuation", () => {
    const r = beancountConfigInputSchema.safeParse({ ...valid, cashAccount: "Assets:-Cash" });
    expect(r.success).toBe(false);
  });

  it("rejects a root outside the five beancount account types", () => {
    const r = beancountConfigInputSchema.safeParse({ ...valid, cashAccount: "Foo:Cash" });
    expect(r.success).toBe(false);
  });

  it("requires the event account", () => {
    const { eventAccount: _, ...rest } = valid;
    expect(beancountConfigInputSchema.safeParse(rest).success).toBe(false);
  });
});

describe("isPushServiceUrl", () => {
  it("accepts the endpoints browsers hand out", () => {
    for (const url of [
      "https://fcm.googleapis.com/fcm/send/abc:def",
      "https://updates.push.services.mozilla.com/wpush/v2/gAAA",
      "https://web.push.apple.com/QGx",
      "https://wns2-par02p.notify.windows.com/w/?token=x",
    ]) {
      expect(isPushServiceUrl(url)).toBe(true);
    }
  });

  it("refuses any other host, plain http and look-alikes", () => {
    for (const url of [
      "https://example.com/push",
      "http://fcm.googleapis.com/fcm/send/abc",
      "https://fcm.googleapis.com.evil.example/x",
      "https://169.254.169.254/latest",
      "not a url",
    ]) {
      expect(isPushServiceUrl(url)).toBe(false);
    }
  });
});

describe("idSchema", () => {
  it("accepts plain positive int4 values", () => {
    expect(idSchema.safeParse(1).success).toBe(true);
    expect(idSchema.safeParse(2_147_483_647).success).toBe(true);
  });

  it("rejects zero, fractions, negatives, overflow and non-numbers", () => {
    for (const v of [0, 1.5, -1, 2_147_483_648, Number.NaN, Infinity, "1", null]) {
      expect(idSchema.safeParse(v).success).toBe(false);
    }
  });
});

describe("groupCreateSchema", () => {
  it("trims the title and keeps the Chinese messages", () => {
    const ok = groupCreateSchema.safeParse({ title: "  日本旅行  ", defaultCurrency: "JPY" });
    expect(ok.success && ok.data.title).toBe("日本旅行");

    const empty = groupCreateSchema.safeParse({ title: "   ", defaultCurrency: "JPY" });
    expect(!empty.success && empty.error.issues[0]?.message).toBe("請輸入群組名稱");

    const long = groupCreateSchema.safeParse({ title: "x".repeat(51), defaultCurrency: "JPY" });
    expect(!long.success && long.error.issues[0]?.message).toBe("群組名稱最多 50 字");
  });

  it("rejects an unsupported default currency", () => {
    expect(groupCreateSchema.safeParse({ title: "a", defaultCurrency: "XYZ" }).success).toBe(false);
  });
});

describe("pushSubscriptionSchema", () => {
  const valid = {
    endpoint: "https://fcm.googleapis.com/fcm/send/abc",
    keys: { p256dh: "p", auth: "a" },
  };

  it("accepts a known push service with keys", () => {
    expect(pushSubscriptionSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects an unknown host, empty keys and an over-long endpoint", () => {
    expect(
      pushSubscriptionSchema.safeParse({ ...valid, endpoint: "https://example.com/x" }).success,
    ).toBe(false);
    expect(
      pushSubscriptionSchema.safeParse({ ...valid, keys: { p256dh: "", auth: "a" } }).success,
    ).toBe(false);
    expect(
      pushSubscriptionSchema.safeParse({
        ...valid,
        endpoint: `https://fcm.googleapis.com/${"x".repeat(2048)}`,
      }).success,
    ).toBe(false);
  });
});
