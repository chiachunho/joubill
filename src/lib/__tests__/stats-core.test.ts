import { describe, expect, it } from "vitest";

import {
  computeNetTrend,
  monthKeyToDate,
  monthKeysBetween,
  resolveStatsRange,
} from "../stats-core";

describe("resolveStatsRange", () => {
  const now = new Date("2026-08-15T12:00:00.000Z");

  it("resolves preset windows back from now", () => {
    expect(resolveStatsRange("3m", now)).toEqual({ from: new Date(2026, 4, 15), to: now });
    expect(resolveStatsRange("6m", now)).toEqual({ from: new Date(2026, 1, 15), to: now });
    expect(resolveStatsRange("1y", now)).toEqual({ from: new Date(2025, 7, 15), to: now });
  });

  it("resolves 'all' to a null lower bound", () => {
    expect(resolveStatsRange("all", now)).toEqual({ from: null, to: now });
  });

  it("resolves a custom range to UTC day boundaries", () => {
    const { from, to } = resolveStatsRange("custom", now, "2026-01-01", "2026-01-31");
    expect(from!.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(to.toISOString()).toBe("2026-01-31T23:59:59.999Z");
  });

  it("rejects a custom range missing from/to", () => {
    expect(() => resolveStatsRange("custom", now)).toThrow();
    expect(() => resolveStatsRange("custom", now, "2026-01-01")).toThrow();
  });

  it("rejects an inverted custom range", () => {
    expect(() => resolveStatsRange("custom", now, "2026-02-01", "2026-01-01")).toThrow();
  });

  it("rejects a malformed custom date", () => {
    expect(() => resolveStatsRange("custom", now, "not-a-date", "2026-01-01")).toThrow();
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
