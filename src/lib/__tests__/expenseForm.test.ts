import { describe, expect, it } from "vitest";

import { expenseFormSchema } from "../zod";

const base = {
  amount: "300",
  currency: "TWD" as const,
  fxRate: "",
  description: "dinner",
  payers: [{ userId: "1", amount: "300" }],
  spentDate: new Date("2026-05-27T12:00:00Z"),
  shareType: "equal" as const,
  participants: [
    { userId: 1, included: true, value: "" },
    { userId: 2, included: true, value: "" },
  ],
};

describe("expenseFormSchema", () => {
  it("accepts a valid equal-split form", () => {
    expect(expenseFormSchema.safeParse(base).success).toBe(true);
  });

  it("rejects a non-numeric / non-positive amount", () => {
    expect(expenseFormSchema.safeParse({ ...base, amount: "" }).success).toBe(false);
    expect(expenseFormSchema.safeParse({ ...base, amount: "0" }).success).toBe(false);
    expect(expenseFormSchema.safeParse({ ...base, amount: "abc" }).success).toBe(false);
  });

  it("accepts an empty or positive fxRate, rejects invalid values", () => {
    expect(expenseFormSchema.safeParse({ ...base, fxRate: "" }).success).toBe(true);
    expect(expenseFormSchema.safeParse({ ...base, fxRate: "0.22" }).success).toBe(true);
    expect(expenseFormSchema.safeParse({ ...base, fxRate: "0" }).success).toBe(false);
    expect(expenseFormSchema.safeParse({ ...base, fxRate: "abc" }).success).toBe(false);
  });

  it("requires at least one included participant", () => {
    const r = expenseFormSchema.safeParse({
      ...base,
      participants: base.participants.map((p) => ({ ...p, included: false })),
    });
    expect(r.success).toBe(false);
  });

  it("equal mode ignores per-row values", () => {
    const r = expenseFormSchema.safeParse({
      ...base,
      participants: [
        { userId: 1, included: true, value: "999" },
        { userId: 2, included: true, value: "" },
      ],
    });
    expect(r.success).toBe(true);
  });

  it("equal mode passes with leftover '1' values from shares mode", () => {
    const r = expenseFormSchema.safeParse({
      ...base,
      shareType: "equal" as const,
      participants: [
        { userId: 1, included: true, value: "1" },
        { userId: 2, included: true, value: "1" },
      ],
    });
    expect(r.success).toBe(true);
  });

  it("equal mode passes with leftover '0' values from adjustment mode", () => {
    const r = expenseFormSchema.safeParse({
      ...base,
      shareType: "equal" as const,
      participants: [
        { userId: 1, included: true, value: "0" },
        { userId: 2, included: true, value: "0" },
      ],
    });
    expect(r.success).toBe(true);
  });

  describe("multi-payer", () => {
    it("accepts two payers when amounts sum to total", () => {
      const r = expenseFormSchema.safeParse({
        ...base,
        amount: "300",
        payers: [
          { userId: "1", amount: "180" },
          { userId: "2", amount: "120" },
        ],
      });
      expect(r.success).toBe(true);
    });

    it("rejects when payer amounts don't sum to total", () => {
      const r = expenseFormSchema.safeParse({
        ...base,
        amount: "300",
        payers: [
          { userId: "1", amount: "100" },
          { userId: "2", amount: "100" },
        ],
      });
      expect(r.success).toBe(false);
      if (!r.success) {
        const msg = r.error.flatten().fieldErrors.payers;
        expect(msg).toBeDefined();
      }
    });

    it("rejects when a payer userId is empty", () => {
      const r = expenseFormSchema.safeParse({
        ...base,
        amount: "300",
        payers: [
          { userId: "", amount: "150" },
          { userId: "2", amount: "150" },
        ],
      });
      expect(r.success).toBe(false);
      if (!r.success) {
        const msg = r.error.flatten().fieldErrors.payers;
        expect(msg).toBeDefined();
      }
    });

    it("rejects non-numeric amount in multi-payer scenario", () => {
      const r = expenseFormSchema.safeParse({
        ...base,
        amount: "300",
        payers: [
          { userId: "1", amount: "abc" },
          { userId: "2", amount: "150" },
        ],
      });
      expect(r.success).toBe(false);
      if (!r.success) {
        const msg = r.error.flatten().fieldErrors.payers;
        expect(msg).toBeDefined();
      }
    });

    it("accepts three payers summing to total", () => {
      const r = expenseFormSchema.safeParse({
        ...base,
        amount: "300",
        payers: [
          { userId: "1", amount: "100" },
          { userId: "2", amount: "100" },
          { userId: "3", amount: "100" },
        ],
      });
      expect(r.success).toBe(true);
    });
  });

  describe("exact mode", () => {
    const exact = { ...base, shareType: "exact" as const };
    it("passes when values sum to the amount", () => {
      const r = expenseFormSchema.safeParse({
        ...exact,
        participants: [
          { userId: 1, included: true, value: "100" },
          { userId: 2, included: true, value: "200" },
        ],
      });
      expect(r.success).toBe(true);
    });
    it("fails when values do not sum to the amount", () => {
      const r = expenseFormSchema.safeParse({
        ...exact,
        participants: [
          { userId: 1, included: true, value: "100" },
          { userId: 2, included: true, value: "100" },
        ],
      });
      expect(r.success).toBe(false);
    });
    it("fails when values are 0.01 short (e.g. 50.00 + 49.99 ≠ 100)", () => {
      const r = expenseFormSchema.safeParse({
        ...exact,
        participants: [
          { userId: 1, included: true, value: "50.00" },
          { userId: 2, included: true, value: "49.99" },
        ],
      });
      expect(r.success).toBe(false);
    });
    it("fails when values are 0.01 over (e.g. 50.00 + 50.01 > 100)", () => {
      const r = expenseFormSchema.safeParse({
        ...exact,
        participants: [
          { userId: 1, included: true, value: "50.00" },
          { userId: 2, included: true, value: "50.01" },
        ],
      });
      expect(r.success).toBe(false);
    });
  });

  describe("percent mode", () => {
    const percent = { ...base, shareType: "percent" as const };
    it("passes when percentages sum to 100", () => {
      const r = expenseFormSchema.safeParse({
        ...percent,
        participants: [
          { userId: 1, included: true, value: "40" },
          { userId: 2, included: true, value: "60" },
        ],
      });
      expect(r.success).toBe(true);
    });
    it("fails when percentages do not sum to 100", () => {
      const r = expenseFormSchema.safeParse({
        ...percent,
        participants: [
          { userId: 1, included: true, value: "40" },
          { userId: 2, included: true, value: "40" },
        ],
      });
      expect(r.success).toBe(false);
    });
    it("fails when percentages are 0.01 short (e.g. 50.00 + 49.99 ≠ 100)", () => {
      const r = expenseFormSchema.safeParse({
        ...percent,
        participants: [
          { userId: 1, included: true, value: "50.00" },
          { userId: 2, included: true, value: "49.99" },
        ],
      });
      expect(r.success).toBe(false);
    });
  });
});
