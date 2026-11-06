import { describe, expect, it } from "vitest";

import {
  computeNetTrend,
  customRangeToQuery,
  monthKeysBetween,
  monthKeyToDay,
  monthsAgo,
  parseLocalDay,
  recentMonthKeys,
  resolveStatsRange,
} from "../stats-core";

describe("resolveStatsRange", () => {
  const today = "2026-08-15";

  it("resolves preset windows back from today", () => {
    expect(resolveStatsRange("3m", today)).toEqual({
      from: "2026-05-15",
      to: today,
      monthsBack: 3,
    });
    expect(resolveStatsRange("6m", today)).toEqual({
      from: "2026-02-15",
      to: today,
      monthsBack: 6,
    });
    expect(resolveStatsRange("1y", today)).toEqual({
      from: "2025-08-15",
      to: today,
      monthsBack: 12,
    });
  });

  it("resolves 'all' to a null lower bound", () => {
    expect(resolveStatsRange("all", today)).toEqual({ from: null, to: today });
  });

  it("resolves a custom range from the days it is given, inclusive", () => {
    expect(resolveStatsRange("custom", today, "2026-01-01", "2026-01-31")).toEqual({
      from: "2026-01-01",
      to: "2026-01-31",
    });
    // One day is a valid range.
    expect(resolveStatsRange("custom", today, "2026-01-01", "2026-01-01")).toEqual({
      from: "2026-01-01",
      to: "2026-01-01",
    });
  });

  it("rejects a custom range missing from/to", () => {
    expect(() => resolveStatsRange("custom", today)).toThrow();
    expect(() => resolveStatsRange("custom", today, "2026-01-01")).toThrow();
  });

  it("rejects an inverted custom range", () => {
    expect(() => resolveStatsRange("custom", today, "2026-02-01", "2026-01-01")).toThrow();
  });

  it("rejects anything that is not a real day", () => {
    expect(() => resolveStatsRange("custom", today, "not-a-date", "2026-01-01")).toThrow();
    expect(() => resolveStatsRange("custom", today, "2026-02-31", "2026-03-01")).toThrow();
    // An instant is the old shape; it is no longer accepted.
    expect(() =>
      resolveStatsRange("custom", today, "2026-01-01T00:00:00.000Z", "2026-01-31"),
    ).toThrow();
  });

  it("clamps the day-of-month instead of overflowing into the next month", () => {
    // Aug 31 minus 6 months would naively construct "Feb 31", which rolls into Mar 3.
    expect(resolveStatsRange("6m", "2026-08-31")).toEqual({
      from: "2026-02-28",
      to: "2026-08-31",
      monthsBack: 6,
    });
    // 3m from a month whose -3 target is Apr (30 days).
    expect(resolveStatsRange("3m", "2026-07-31")).toEqual({
      from: "2026-04-30",
      to: "2026-07-31",
      monthsBack: 3,
    });
    // A leap-year February is not clamped further than necessary.
    expect(resolveStatsRange("6m", "2028-08-29")).toEqual({
      from: "2028-02-29",
      to: "2028-08-29",
      monthsBack: 6,
    });
  });

  it("does not clamp when the target month has enough days", () => {
    expect(resolveStatsRange("1y", "2026-01-15")).toEqual({
      from: "2025-01-15",
      to: "2026-01-15",
      monthsBack: 12,
    });
  });
});

describe("monthsAgo", () => {
  it("crosses a year boundary", () => {
    expect(monthsAgo("2026-02-10", 3)).toBe("2025-11-10");
    expect(monthsAgo("2026-01-31", 2)).toBe("2025-11-30");
  });
});

describe("monthKeysBetween", () => {
  it("returns a single key for a same-month range", () => {
    expect(monthKeysBetween("2026-08-01", "2026-08-28")).toEqual(["2026-08"]);
  });

  it("spans multiple months inclusive of both ends", () => {
    expect(monthKeysBetween("2026-03-15", "2026-06-03")).toEqual([
      "2026-03",
      "2026-04",
      "2026-05",
      "2026-06",
    ]);
  });

  it("crosses a year boundary", () => {
    expect(monthKeysBetween("2025-11-01", "2026-02-01")).toEqual([
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
    ]);
  });
});

describe("monthKeyToDay", () => {
  it("is the first of the month, and round-trips with monthKeysBetween", () => {
    for (const key of monthKeysBetween("2026-03-15", "2026-06-03")) {
      expect(monthKeyToDay(key)).toBe(`${key}-01`);
      expect(monthKeysBetween(monthKeyToDay(key), monthKeyToDay(key))).toEqual([key]);
    }
  });
});

describe("recentMonthKeys", () => {
  it("always returns exactly `count` keys, regardless of day-of-month", () => {
    // An exact-day 6-month window from Aug 15 spans 7 labeled months; this must not.
    expect(recentMonthKeys("2026-08-15", 6)).toEqual([
      "2026-03",
      "2026-04",
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
    ]);
    expect(recentMonthKeys("2026-08-01", 6)).toHaveLength(6);
    expect(recentMonthKeys("2026-08-31", 6)).toHaveLength(6);
  });

  it("crosses a year boundary", () => {
    expect(recentMonthKeys("2026-02-10", 3)).toEqual(["2025-12", "2026-01", "2026-02"]);
  });

  it("returns a single key for count=1", () => {
    expect(recentMonthKeys("2026-08-15", 1)).toEqual(["2026-08"]);
  });

  it("returns nothing for a non-positive count", () => {
    expect(recentMonthKeys("2026-08-15", 0)).toEqual([]);
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
    expect(parseLocalDay("2026-01-15").getDate()).toBe(15);
  });
});

describe("customRangeToQuery", () => {
  it("returns nothing for a non-custom range", () => {
    expect(customRangeToQuery({ key: "6m" })).toEqual({});
  });

  it("returns nothing when custom is picked but a day is still missing", () => {
    expect(customRangeToQuery({ key: "custom", from: "2026-01-01" })).toEqual({});
    expect(customRangeToQuery({ key: "custom" })).toEqual({});
  });

  it("sends the picked days as they are", () => {
    expect(customRangeToQuery({ key: "custom", from: "2026-01-01", to: "2026-01-15" })).toEqual({
      from: "2026-01-01",
      to: "2026-01-15",
    });
  });

  it("feeds straight into resolveStatsRange", () => {
    const q = customRangeToQuery({ key: "custom", from: "2026-01-01", to: "2026-01-01" });
    expect(resolveStatsRange("custom", "2026-08-15", q.from, q.to)).toEqual({
      from: "2026-01-01",
      to: "2026-01-01",
    });
  });
});

describe("computeNetTrend", () => {
  it("returns an empty series for no legs and no from", () => {
    expect(computeNetTrend([], null)).toEqual([]);
  });

  it("accumulates legs in chronological order regardless of input order", () => {
    const legs = [
      { date: "2026-01-03", amount: -50 },
      { date: "2026-01-01", amount: 100 },
      { date: "2026-01-02", amount: 30 },
    ];
    expect(computeNetTrend(legs, null)).toEqual([
      { date: "2026-01-01", net: 100 },
      { date: "2026-01-02", net: 130 },
      { date: "2026-01-03", net: 80 },
    ]);
  });

  it("anchors the series at `from` with the carried-in total, not reset to 0", () => {
    const legs = [
      { date: "2026-01-01", amount: 200 },
      { date: "2026-03-01", amount: -50 },
      { date: "2026-06-01", amount: 30 },
    ];
    const points = computeNetTrend(legs, "2026-05-01");
    expect(points[0]).toEqual({ date: "2026-05-01", net: 150 });
    expect(points[1]).toEqual({ date: "2026-06-01", net: 180 });
    expect(points).toHaveLength(2);
  });

  it("still anchors a flat line when every leg predates the window", () => {
    const legs = [
      { date: "2026-01-01", amount: 100 },
      { date: "2026-01-15", amount: -20 },
    ];
    expect(computeNetTrend(legs, "2026-06-01")).toEqual([{ date: "2026-06-01", net: 80 }]);
  });

  it("does not duplicate the anchor when a leg lands exactly on `from`", () => {
    const legs = [
      { date: "2026-01-01", amount: 100 },
      { date: "2026-05-01", amount: 20 },
    ];
    expect(computeNetTrend(legs, "2026-05-01")).toEqual([{ date: "2026-05-01", net: 120 }]);
  });

  it("rounds to cents", () => {
    const legs = [
      { date: "2026-01-01", amount: 10.005 },
      { date: "2026-01-02", amount: 0.0049 },
    ];
    expect(computeNetTrend(legs, null)[1].net).toBeCloseTo(10.01, 2);
  });
});
