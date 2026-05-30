import { describe, expect, it } from "vitest";

import { expenseInputSchema, settlementInputSchema } from "../zod";

const validExpense = {
  amount: 300,
  currency: "TWD" as const,
  description: "dinner",
  payerId: 1,
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

  it("accepts a receiptFileId string", () => {
    expect(
      expenseInputSchema.safeParse({ ...validExpense, receiptFileId: "AgACAgIAAx" }).success,
    ).toBe(true);
  });

  it("accepts null receiptFileId", () => {
    expect(
      expenseInputSchema.safeParse({ ...validExpense, receiptFileId: null }).success,
    ).toBe(true);
  });

  it("accepts missing receiptFileId (optional)", () => {
    const { receiptFileId: _, ...withoutReceipt } = { ...validExpense, receiptFileId: undefined };
    expect(expenseInputSchema.safeParse(withoutReceipt).success).toBe(true);
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
});
