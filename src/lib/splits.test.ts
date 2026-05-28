import { describe, expect, it } from "vitest";

import { computeSplits } from "./splits";

describe("computeSplits", () => {
  it("returns nothing with no participants", () => {
    expect(computeSplits(100, "equal", [])).toEqual([]);
  });

  describe("equal", () => {
    it("divides evenly", () => {
      expect(computeSplits(30, "equal", [{ userId: 1 }, { userId: 2 }, { userId: 3 }])).toEqual([
        { debtorId: 1, amount: 10 },
        { debtorId: 2, amount: 10 },
        { debtorId: 3, amount: 10 },
      ]);
    });

    it("spreads the remainder cent over the first debtors", () => {
      expect(computeSplits(10, "equal", [{ userId: 1 }, { userId: 2 }, { userId: 3 }])).toEqual([
        { debtorId: 1, amount: 3.34 },
        { debtorId: 2, amount: 3.33 },
        { debtorId: 3, amount: 3.33 },
      ]);
    });

    it("ignores per-row values in equal mode", () => {
      const result = computeSplits(20, "equal", [
        { userId: 1, value: "999" },
        { userId: 2, value: "0" },
      ]);
      expect(result).toEqual([
        { debtorId: 1, amount: 10 },
        { debtorId: 2, amount: 10 },
      ]);
    });
  });

  describe("exact", () => {
    it("uses each participant's entered amount", () => {
      expect(
        computeSplits(300, "exact", [
          { userId: 1, value: "100" },
          { userId: 2, value: "200" },
        ]),
      ).toEqual([
        { debtorId: 1, amount: 100 },
        { debtorId: 2, amount: 200 },
      ]);
    });

    it("treats blank / invalid input as 0", () => {
      expect(
        computeSplits(100, "exact", [
          { userId: 1, value: "" },
          { userId: 2, value: "abc" },
          { userId: 3 },
        ]),
      ).toEqual([
        { debtorId: 1, amount: 0 },
        { debtorId: 2, amount: 0 },
        { debtorId: 3, amount: 0 },
      ]);
    });
  });

  describe("percent", () => {
    it("converts percentages to cent-rounded amounts", () => {
      expect(
        computeSplits(200, "percent", [
          { userId: 1, value: "40" },
          { userId: 2, value: "60" },
        ]),
      ).toEqual([
        { debtorId: 1, amount: 80 },
        { debtorId: 2, amount: 120 },
      ]);
    });

    it("rounds fractional cents", () => {
      // 33.333% of 100 = 33.333 -> 33.33
      const result = computeSplits(100, "percent", [{ userId: 1, value: "33.333" }]);
      expect(result[0].amount).toBeCloseTo(33.33, 2);
    });
  });
});
