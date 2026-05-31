import { describe, expect, it } from "vitest";

import { computeSplits } from "../splits";

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

  describe("shares", () => {
    it("splits proportionally by share count", () => {
      expect(
        computeSplits(300, "shares", [
          { userId: 1, value: "1" },
          { userId: 2, value: "2" },
        ]),
      ).toEqual([
        { debtorId: 1, amount: 100 },
        { debtorId: 2, amount: 200 },
      ]);
    });

    it("distributes remainder cents via largest-remainder (sums exactly to total)", () => {
      // 100 / 3 shares equally → [33.34, 33.33, 33.33]
      const result = computeSplits(100, "shares", [
        { userId: 1, value: "1" },
        { userId: 2, value: "1" },
        { userId: 3, value: "1" },
      ]);
      expect(result.reduce((s, x) => s + x.amount, 0)).toBeCloseTo(100, 2);
      expect(result[0].amount).toBe(33.34);
      expect(result[1].amount).toBe(33.33);
      expect(result[2].amount).toBe(33.33);
    });

    it("defaults missing value to 0 shares and returns 0", () => {
      const result = computeSplits(100, "shares", [{ userId: 1, value: "0" }]);
      expect(result[0].amount).toBe(0);
    });

    it("returns zeros when total shares is 0", () => {
      const result = computeSplits(100, "shares", [{ userId: 1, value: "0" }, { userId: 2, value: "0" }]);
      expect(result).toEqual([{ debtorId: 1, amount: 0 }, { debtorId: 2, amount: 0 }]);
    });
  });

  describe("adjustment", () => {
    it("adds each person's extra to an equal base split of the remainder", () => {
      // Total 1000, A pays extra 200 (wine), B pays extra 150 (wine), 4 people
      // Remainder = 1000 - 200 - 150 = 650, base = 650/4 = 162.5 each
      const result = computeSplits(1000, "adjustment", [
        { userId: 1, value: "200" },
        { userId: 2, value: "150" },
        { userId: 3, value: "0" },
        { userId: 4, value: "0" },
      ]);
      expect(result).toEqual([
        { debtorId: 1, amount: 362.5 },
        { debtorId: 2, amount: 312.5 },
        { debtorId: 3, amount: 162.5 },
        { debtorId: 4, amount: 162.5 },
      ]);
      expect(result.reduce((s, x) => s + x.amount, 0)).toBeCloseTo(1000, 2);
    });

    it("zero adjustments behave like equal split", () => {
      const result = computeSplits(90, "adjustment", [
        { userId: 1, value: "0" },
        { userId: 2, value: "0" },
        { userId: 3, value: "0" },
      ]);
      expect(result).toEqual([
        { debtorId: 1, amount: 30 },
        { debtorId: 2, amount: 30 },
        { debtorId: 3, amount: 30 },
      ]);
    });

    it("distributes remainder cents precisely", () => {
      // Total 100, A extra 10, B extra 0, C extra 0 → remainder 90/3 = 30 each
      const result = computeSplits(100, "adjustment", [
        { userId: 1, value: "10" },
        { userId: 2, value: "0" },
        { userId: 3, value: "0" },
      ]);
      expect(result.reduce((s, x) => s + x.amount, 0)).toBeCloseTo(100, 2);
      expect(result[0].amount).toBe(40);
      expect(result[1].amount).toBe(30);
      expect(result[2].amount).toBe(30);
    });
  });
});
