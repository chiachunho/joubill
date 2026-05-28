import { describe, expect, it } from "vitest";

import { formatMoney, n, splitEqual } from "./money";

describe("splitEqual", () => {
  it("divides evenly when it can", () => {
    expect(splitEqual(30, 3)).toEqual([10, 10, 10]);
    expect(splitEqual(100, 4)).toEqual([25, 25, 25, 25]);
  });

  it("spreads the remainder over the first shares (cent-precise)", () => {
    expect(splitEqual(10, 3)).toEqual([3.34, 3.33, 3.33]);
    expect(splitEqual(100, 3)).toEqual([33.34, 33.33, 33.33]);
  });

  it("always sums back to the original amount", () => {
    for (const [amount, count] of [
      [10, 3],
      [100, 7],
      [0.1, 3],
      [999.99, 11],
      [1, 6],
    ] as const) {
      const shares = splitEqual(amount, count);
      const sum = shares.reduce((s, x) => s + x, 0);
      expect(Math.round(sum * 100)).toBe(Math.round(amount * 100));
    }
  });

  it("handles a single participant", () => {
    expect(splitEqual(42.5, 1)).toEqual([42.5]);
  });

  it("throws on non-positive count", () => {
    expect(() => splitEqual(10, 0)).toThrow();
    expect(() => splitEqual(10, -1)).toThrow();
  });
});

describe("formatMoney", () => {
  it("prefixes a + sign for positive amounts", () => {
    expect(formatMoney(1234.5, "TWD")).toBe("+1,234.50 TWD");
  });

  it("keeps the - sign for negative amounts", () => {
    expect(formatMoney(-99, "USD")).toBe("-99.00 USD");
  });

  it("does not sign zero", () => {
    expect(formatMoney(0, "JPY")).toBe("0.00 JPY");
  });
});

describe("n", () => {
  it("parses Drizzle numeric strings", () => {
    expect(n("123.45")).toBe(123.45);
  });

  it("passes numbers through", () => {
    expect(n(67.8)).toBe(67.8);
  });
});
