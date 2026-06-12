import { describe, expect, it } from "vitest";

import { expenseInputSchema, settlementInputSchema } from "../zod";

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
      expenseInputSchema.safeParse({ ...validExpense, receiptFileIds: ["AgACAgIAAx", "BgACBgIBBy"] }).success,
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
