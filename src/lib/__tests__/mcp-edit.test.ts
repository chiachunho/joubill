import { describe, expect, it } from "vitest";

import { carryOverPayers, carryOverSplit, sameInstantIso } from "@/lib/mcp-edit";

const split = (
  memberId: number,
  amount: number,
  shareType = "equal",
  weight: number | null = null,
) => ({
  memberId,
  amount,
  shareType,
  weight,
});

describe("carryOverPayers", () => {
  it("a sole payer follows a new total", () => {
    expect(carryOverPayers([{ memberId: 1, amount: 100 }], true)).toEqual({
      ok: true,
      value: [{ userId: 1 }],
    });
  });

  it("several payers are kept while the total is unchanged and refused when it moves", () => {
    const stored = [
      { memberId: 1, amount: 60 },
      { memberId: 2, amount: 40 },
    ];
    expect(carryOverPayers(stored, false)).toEqual({
      ok: true,
      value: [
        { userId: 1, amount: 60 },
        { userId: 2, amount: 40 },
      ],
    });
    const moved = carryOverPayers(stored, true);
    expect(moved.ok).toBe(false);
    expect(!moved.ok && moved.message).toContain("payers");
  });
});

describe("carryOverSplit", () => {
  it("keeps who shares an equal split and lets the amounts follow the total", () => {
    expect(carryOverSplit([split(1, 50), split(2, 50)], true)).toEqual({
      ok: true,
      value: { type: "equal", userIds: [1, 2] },
    });
  });

  it("keeps share weights", () => {
    expect(carryOverSplit([split(1, 75, "shares", 3), split(2, 25, "shares", 1)], true)).toEqual({
      ok: true,
      value: {
        type: "shares",
        shares: [
          { userId: 1, weight: 3 },
          { userId: 2, weight: 1 },
        ],
      },
    });
  });

  it("keeps per-person amounts only while the total is unchanged", () => {
    const stored = [split(1, 70, "exact"), split(2, 30, "exact")];
    expect(carryOverSplit(stored, false)).toEqual({
      ok: true,
      value: {
        type: "exact",
        amounts: [
          { userId: 1, amount: 70 },
          { userId: 2, amount: 30 },
        ],
      },
    });
    expect(carryOverSplit(stored, true).ok).toBe(false);
  });
});

describe("sameInstantIso", () => {
  it("matches the same instant and tolerates microsecond truncation", () => {
    expect(sameInstantIso("2026-11-06T10:00:00.123Z", "2026-11-06T10:00:00.123Z")).toBe(true);
    expect(sameInstantIso("2026-11-06T10:00:00.123Z", "2026-11-06T10:00:00.124Z")).toBe(true);
  });

  it("rejects a later edit and garbage", () => {
    expect(sameInstantIso("2026-11-06T10:00:00.000Z", "2026-11-06T10:00:01.000Z")).toBe(false);
    expect(sameInstantIso("2026-11-06T10:00:00.000Z", "nope")).toBe(false);
  });
});
