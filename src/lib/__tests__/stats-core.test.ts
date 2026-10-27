import { describe, expect, it } from "vitest";

import {
  computeNetTrend,
  customRangeToQueryBounds,
  monthKeyToDate,
  monthKeysBetween,
  parseLocalDay,
  recentMonthKeys,
  resolveStatsRange,
} from "../stats-core";

describe("resolveStatsRange", () => {
  const now = new Date("2026-08-15T12:00:00.000Z");

  it("resolves preset windows back from now", () => {
    expect(resolveStatsRange("3m", now)).toEqual({
      from: new Date(2026, 4, 15),
      to: now,
      monthsBack: 3,
    });
    expect(resolveStatsRange("6m", now)).toEqual({
      from: new Date(2026, 1, 15),
      to: now,
      monthsBack: 6,
    });
    expect(resolveStatsRange("1y", now)).toEqual({
      from: new Date(2025, 7, 15),
      to: now,
      monthsBack: 12,
    });
  });

  it("resolves 'all' to a null lower bound", () => {
    expect(resolveStatsRange("all", now)).toEqual({ from: null, to: now });
  });

  it("resolves a custom range from exact ISO instants, no reinterpretation", () => {
    const { from, to } = resolveStatsRange(
      "custom",
      now,
      "2026-01-01T00:00:00.000Z",
      "2026-01-31T23:59:59.999Z",
    );
    expect(from!.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(to.toISOString()).toBe("2026-01-31T23:59:59.999Z");
  });

  it("rejects a custom range missing from/to", () => {
    expect(() => resolveStatsRange("custom", now)).toThrow();
    expect(() => resolveStatsRange("custom", now, "2026-01-01T00:00:00.000Z")).toThrow();
  });

  it("rejects an inverted custom range", () => {
    expect(() =>
      resolveStatsRange("custom", now, "2026-02-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z"),
    ).toThrow();
  });

  it("rejects a malformed custom date", () => {
    expect(() =>
      resolveStatsRange("custom", now, "not-a-date", "2026-01-01T00:00:00.000Z"),
    ).toThrow();
  });

  it("clamps the day-of-month instead of overflowing into the next month", () => {
    // Aug 31 minus 6 months would naively construct "Feb 31", which JS Date
    // normalizes into Mar 3 (2026 is not a leap year) — must clamp to Feb 28.
    const aug31 = new Date(2026, 7, 31);
    expect(resolveStatsRange("6m", aug31)).toEqual({
      from: new Date(2026, 1, 28),
      to: aug31,
      monthsBack: 6,
    });
    // Same day-31 problem one month back (3m from a month whose -3 target is Apr, 30 days).
    const jul31 = new Date(2026, 6, 31);
    expect(resolveStatsRange("3m", jul31)).toEqual({
      from: new Date(2026, 3, 30),
      to: jul31,
      monthsBack: 3,
    });
    // A leap-year February should NOT be clamped down further than necessary.
    const aug29 = new Date(2028, 7, 29);
    expect(resolveStatsRange("6m", aug29)).toEqual({
      from: new Date(2028, 1, 29),
      to: aug29,
      monthsBack: 6,
    });
  });

  it("does not clamp when the target month has enough days", () => {
    const jan15 = new Date(2026, 0, 15);
    expect(resolveStatsRange("1y", jan15)).toEqual({
      from: new Date(2025, 0, 15),
      to: jan15,
      monthsBack: 12,
    });
  });
});

describe("monthKeysBetween", () => {
  it("returns a single key for a same-month range", () => {
    expect(monthKeysBetween(new Date(2026, 7, 1), new Date(2026, 7, 28))).toEqual(["2026-08"]);
  });

  it("spans multiple months inclusive of both ends", () => {
    expect(monthKeysBetween(new Date(2026, 2, 15), new Date(2026, 5, 3))).toEqual([
      "2026-03",
      "2026-04",
      "2026-05",
      "2026-06",
    ]);
  });

  it("crosses a year boundary", () => {
    expect(monthKeysBetween(new Date(2025, 10, 1), new Date(2026, 1, 1))).toEqual([
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
    ]);
  });
});

describe("monthKeyToDate", () => {
  it("round-trips with monthKeysBetween", () => {
    const from = new Date(2026, 2, 15);
    const to = new Date(2026, 5, 3);
    for (const key of monthKeysBetween(from, to)) {
      expect(monthKeyToDate(key).getMonth()).toBe(Number(key.split("-")[1]) - 1);
      expect(monthKeyToDate(key).getDate()).toBe(1);
    }
  });
});

describe("recentMonthKeys", () => {
  it("always returns exactly `count` keys, regardless of day-of-month", () => {
    // Aug 15 minus a 6-month EXACT-DAY window spans Feb 15..Aug 15 = 7 labeled
    // months (Feb,Mar,Apr,May,Jun,Jul,Aug) — recentMonthKeys must not do that.
    expect(recentMonthKeys(new Date(2026, 7, 15), 6)).toEqual([
      "2026-03",
      "2026-04",
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
    ]);
    // Same count regardless of which day of August `to` falls on.
    expect(recentMonthKeys(new Date(2026, 7, 1), 6)).toHaveLength(6);
    expect(recentMonthKeys(new Date(2026, 7, 31), 6)).toHaveLength(6);
  });

  it("crosses a year boundary", () => {
    expect(recentMonthKeys(new Date(2026, 1, 10), 3)).toEqual(["2025-12", "2026-01", "2026-02"]);
  });

  it("returns a single key for count=1", () => {
    expect(recentMonthKeys(new Date(2026, 7, 15), 1)).toEqual(["2026-08"]);
  });

  it("returns nothing for a non-positive count", () => {
    expect(recentMonthKeys(new Date(2026, 7, 15), 0)).toEqual([]);
  });
});

describe("parseLocalDay", () => {
  it("round-trips a YYYY-MM-DD string to the same local calendar date", () => {
    const d = parseLocalDay("2026-01-15");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(0);
    expect(d.getDate()).toBe(15);
    expect(d.getHours()).toBe(0);
  });

  it("does not shift a day near the UTC boundary the way `new Date(str)` would", () => {
    // new Date("2026-01-15") is UTC midnight, which is Jan 14 local in any
    // negative-UTC-offset timezone — parseLocalDay must always read back the
    // literal calendar date regardless of which timezone the test runs in.
    expect(parseLocalDay("2026-01-15").getDate()).toBe(15);
  });
});

describe("customRangeToQueryBounds", () => {
  it("returns nothing for a non-custom range", () => {
    expect(customRangeToQueryBounds({ key: "6m" })).toEqual({});
  });

  it("returns nothing when custom is picked but a day is still missing", () => {
    expect(customRangeToQueryBounds({ key: "custom", from: "2026-01-01" })).toEqual({});
    expect(customRangeToQueryBounds({ key: "custom" })).toEqual({});
  });

  it("converts the picked local days to start/end-of-day instants", () => {
    const bounds = customRangeToQueryBounds({
      key: "custom",
      from: "2026-01-01",
      to: "2026-01-15",
    });
    const expectedFrom = new Date(2026, 0, 1);
    const expectedTo = new Date(2026, 0, 15, 23, 59, 59, 999);
    expect(bounds.from).toBe(expectedFrom.toISOString());
    expect(bounds.to).toBe(expectedTo.toISOString());
  });

  it("feeds straight into resolveStatsRange without further reinterpretation", () => {
    const bounds = customRangeToQueryBounds({
      key: "custom",
      from: "2026-01-01",
      to: "2026-01-01",
    });
    const { from, to } = resolveStatsRange("custom", new Date(), bounds.from, bounds.to);
    // The whole local day is covered, not just its UTC midnight instant.
    expect(from!.getTime()).toBeLessThan(to.getTime());
    expect(to.getTime() - from!.getTime()).toBeGreaterThan(23 * 60 * 60 * 1000);
  });
});

describe("computeNetTrend", () => {
  it("returns an empty series for no legs and no from", () => {
    expect(computeNetTrend([], null)).toEqual([]);
  });

  it("accumulates legs in chronological order regardless of input order", () => {
    const legs = [
      { date: new Date("2026-01-03"), amount: -50 },
      { date: new Date("2026-01-01"), amount: 100 },
      { date: new Date("2026-01-02"), amount: 30 },
    ];
    const points = computeNetTrend(legs, null);
    expect(points).toEqual([
      { date: new Date("2026-01-01").toISOString(), net: 100 },
      { date: new Date("2026-01-02").toISOString(), net: 130 },
      { date: new Date("2026-01-03").toISOString(), net: 80 },
    ]);
  });

  it("anchors the series at `from` with the carried-in total, not reset to 0", () => {
    const legs = [
      { date: new Date("2026-01-01"), amount: 200 },
      { date: new Date("2026-03-01"), amount: -50 },
      { date: new Date("2026-06-01"), amount: 30 },
    ];
    const points = computeNetTrend(legs, new Date("2026-05-01"));
    expect(points[0]).toEqual({ date: new Date("2026-05-01").toISOString(), net: 150 });
    expect(points[1]).toEqual({ date: new Date("2026-06-01").toISOString(), net: 180 });
    expect(points).toHaveLength(2);
  });

  it("still anchors a flat line when every leg predates the window", () => {
    const legs = [
      { date: new Date("2026-01-01"), amount: 100 },
      { date: new Date("2026-01-15"), amount: -20 },
    ];
    const points = computeNetTrend(legs, new Date("2026-06-01"));
    expect(points).toEqual([{ date: new Date("2026-06-01").toISOString(), net: 80 }]);
  });

  it("does not duplicate the anchor when a leg lands exactly on `from`", () => {
    const from = new Date("2026-05-01");
    const legs = [
      { date: new Date("2026-01-01"), amount: 100 },
      { date: from, amount: 20 },
    ];
    const points = computeNetTrend(legs, from);
    expect(points).toEqual([{ date: from.toISOString(), net: 120 }]);
  });

  it("rounds to cents", () => {
    const legs = [
      { date: new Date("2026-01-01"), amount: 10.005 },
      { date: new Date("2026-01-02"), amount: 0.0049 },
    ];
    const points = computeNetTrend(legs, null);
    expect(points[1].net).toBeCloseTo(10.01, 2);
  });
});
