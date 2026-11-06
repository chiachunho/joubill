import { isDay } from "./day";

/** Preset windows for the stats page; "custom" requires explicit from/to. */
export type StatsRangeKey = "3m" | "6m" | "1y" | "all" | "custom";

/** All bounds are calendar days (`YYYY-MM-DD`), the same type a record's date is. */
export type ResolvedRange = {
  /** Inclusive lower bound. Null only for "all" — the caller resolves that to
   *  the group's earliest record, since stats-core has no DB access. */
  from: string | null;
  /** Inclusive upper bound. */
  to: string;
  /** Set only for "3m"/"6m"/"1y" — the net-trend anchor (`from`) is an exact
   *  day-count window, but the monthly chart / ranking want "the last N
   *  calendar months" (matching the help doc's "選 6 個月會看到 6 根長條"),
   *  which is a different, month-aligned span. The caller uses this to build
   *  that span with `recentMonthKeys` instead of `from`. */
  monthsBack?: number;
};

/**
 * Resolves a range key (+ optional custom bounds) to concrete from/to days.
 * Pure — no DB, no "now" side effect (caller passes `today`, the group's today).
 *
 * `customFrom`/`customTo` are bare `YYYY-MM-DD` days, inclusive on both ends. A
 * record's date has no time and no zone, so a picked day needs no translation.
 *
 * Throws on a malformed or inverted custom range so the route can turn that
 * into a 400 instead of silently swapping or dropping bounds.
 */
export function resolveStatsRange(
  range: StatsRangeKey,
  today: string,
  customFrom?: string,
  customTo?: string,
): ResolvedRange {
  if (range === "custom") {
    if (!customFrom || !customTo) {
      throw new Error("custom range requires both from and to");
    }
    if (!isDay(customFrom) || !isDay(customTo)) {
      throw new Error("invalid from/to date");
    }
    if (customFrom > customTo) {
      throw new Error("from must not be after to");
    }
    return { from: customFrom, to: customTo };
  }
  if (range === "all") return { from: null, to: today };

  const monthsBack = range === "3m" ? 3 : range === "6m" ? 6 : 12;
  return { from: monthsAgo(today, monthsBack), to: today, monthsBack };
}

/**
 * The same day-of-month `count` months before `day`, clamped to the target month's
 * length: naively reusing the day overflows into the following month whenever the
 * target month is shorter (Aug 31 minus 6 months would land on Mar 3, not Feb 28).
 */
export function monthsAgo(day: string, count: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const index = y * 12 + (m - 1) - count;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(Math.min(d, lastDay)).padStart(2, "0")}`;
}

function monthIndexOf(day: string): number {
  const [y, m] = day.split("-").map(Number);
  return y * 12 + (m - 1);
}

function keyOfMonthIndex(index: number): string {
  return `${String(Math.floor(index / 12)).padStart(4, "0")}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** "YYYY-MM" keys for every month from `from` to `to` (days), inclusive on both ends. */
export function monthKeysBetween(from: string, to: string): string[] {
  const keys: string[] = [];
  for (let i = monthIndexOf(from); i <= monthIndexOf(to); i++) keys.push(keyOfMonthIndex(i));
  return keys;
}

/** The last `count` calendar months ending at (and including) `to`'s month —
 *  e.g. count=6 from an August `to` gives Mar..Aug, always exactly 6 keys
 *  regardless of day-of-month (unlike `monthKeysBetween` against an exact
 *  day-count `from`, which almost never lands on a month boundary). */
export function recentMonthKeys(to: string, count: number): string[] {
  if (count <= 0) return [];
  const end = monthIndexOf(to);
  const keys: string[] = [];
  for (let i = end - (count - 1); i <= end; i++) keys.push(keyOfMonthIndex(i));
  return keys;
}

/** Inverse of the key format produced by `monthKeysBetween`: "YYYY-MM" -> the first day of that month. */
export function monthKeyToDay(key: string): string {
  return `${key}-01`;
}

/**
 * The query parameters for a custom range: the days the viewer picked, as they are.
 * Empty until both ends are chosen.
 */
export function customRangeToQuery(value: { key: StatsRangeKey; from?: string; to?: string }): {
  from?: string;
  to?: string;
} {
  if (value.key !== "custom" || !value.from || !value.to) return {};
  return { from: value.from, to: value.to };
}

/** A single signed contribution to a user's net balance: positive when they
 *  paid, negative when they owed. Caller has already summed same-record
 *  payer/split legs and converted to the group's default currency. */
export type NetLeg = { date: string; amount: number };

export type NetTrendPoint = { date: string; net: number };

/**
 * Cumulative running net balance over time — the same quantity Balance shows
 * as a single current number, plotted as a series. Legs before `from` are
 * folded into a synthetic anchor point at `from` (rather than dropped or
 * reset to 0) so:
 *   - the rightmost point always matches the user's true current balance,
 *   - a window with no activity still renders a flat, correctly-valued line
 *     instead of an empty chart.
 * `from: null` returns the whole history with no anchor point.
 */
export function computeNetTrend(legs: NetLeg[], from: string | null): NetTrendPoint[] {
  const sorted = [...legs].sort((a, b) => a.date.localeCompare(b.date));
  const points: NetTrendPoint[] = [];
  let running = 0;
  let carried = 0;

  for (const leg of sorted) {
    running += leg.amount;
    const rounded = Math.round(running * 100) / 100;
    if (from && leg.date < from) {
      carried = rounded;
      continue;
    }
    points.push({ date: leg.date, net: rounded });
  }

  if (from) {
    const first = points[0];
    if (!first || first.date !== from) {
      points.unshift({ date: from, net: carried });
    }
  }

  return points;
}
