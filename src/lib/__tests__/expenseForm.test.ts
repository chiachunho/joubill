import { describe, expect, it } from "vitest";

import { expenseFormSchema } from "../zod";

const base = {
  amount: "300",
  currency: "TWD" as const,
  description: "dinner",
  payerId: "1",
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
  });
});
