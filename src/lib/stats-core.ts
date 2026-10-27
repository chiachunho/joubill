/** Preset windows for the stats page; "custom" requires explicit from/to. */
export type StatsRangeKey = "3m" | "6m" | "1y" | "all" | "custom";

export type ResolvedRange = {
  /** Inclusive lower bound. Null only for "all" — the caller resolves that to
   *  the group's earliest record, since stats-core has no DB access. */
  from: Date | null;
  /** Inclusive upper bound. */
  to: Date;
  /** Set only for "3m"/"6m"/"1y" — the net-trend anchor (`from`) is an exact
   *  day-count window, but the monthly chart / ranking want "the last N
   *  calendar months" (matching the help doc's "選 6 個月會看到 6 根長條"),
   *  which is a different, month-aligned span. The caller uses this to build
   *  that span with `recentMonthKeys` instead of `from`. */
  monthsBack?: number;
};

/**
 * Resolves a range key (+ optional custom bounds) to concrete from/to dates.
 * Pure — no DB, no "now" side effect (caller passes `now`).
 *
 * `customFrom`/`customTo` are full ISO instants, not bare "YYYY-MM-DD" —
 * only the browser knows the viewer's local day boundaries (there's no
 * server-side timezone to guess from), so the client resolves "the day I
 * clicked" to an exact UTC instant itself (see `customRangeToQueryBounds`)
 * and this just parses what it's given.
 *
 * Throws on a malformed or inverted custom range so the route can turn that
 * into a 400 instead of silently swapping or dropping bounds.
 */
export function resolveStatsRange(
  range: StatsRangeKey,
  now: Date,
  customFrom?: string,
  customTo?: string,
): ResolvedRange {
  if (range === "custom") {
    if (!customFrom || !customTo) {
      throw new Error("custom range requires both from and to");
    }
    const from = new Date(customFrom);
    const to = new Date(customTo);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new Error("invalid from/to date");
    }
    if (from.getTime() > to.getTime()) {
      throw new Error("from must not be after to");
    }
    return { from, to };
  }
  if (range === "all") return { from: null, to: now };

  const monthsBack = range === "3m" ? 3 : range === "6m" ? 6 : 12;
  // Clamp the day-of-month to the target month's actual length: naively
  // reusing now.getDate() overflows into the following month whenever the
  // target month is shorter (e.g. Aug 31 minus 6 months would land on
  // Mar 3 instead of Feb 28/29, via JS Date's automatic day rollover).
  const targetYear = now.getFullYear();
  const targetMonth = now.getMonth() - monthsBack;
  const daysInTargetMonth = new Date(targetYear, targetMonth + 1, 0).getDate();
  const day = Math.min(now.getDate(), daysInTargetMonth);
  const from = new Date(targetYear, targetMonth, day);
  return { from, to: now, monthsBack };
}

/** "YYYY-MM" keys for every month from `from` to `to`, inclusive on both ends. */
export function monthKeysBetween(from: Date, to: Date): string[] {
  const keys: string[] = [];
  const cursor = new Date(from.getFullYear(), from.getMonth(), 1);
  const end = new Date(to.getFullYear(), to.getMonth(), 1);
  while (cursor.getTime() <= end.getTime()) {
    keys.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`);
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return keys;
}

/** The last `count` calendar months ending at (and including) `to`'s month —
 *  e.g. count=6 from an August `to` gives Mar..Aug, always exactly 6 keys
 *  regardless of day-of-month (unlike `monthKeysBetween` against an exact
 *  day-count `from`, which almost never lands on a month boundary). */
export function recentMonthKeys(to: Date, count: number): string[] {
  if (count <= 0) return [];
  const end = new Date(to.getFullYear(), to.getMonth(), 1);
  const start = new Date(end.getFullYear(), end.getMonth() - (count - 1), 1);
  return monthKeysBetween(start, end);
}

/** Inverse of the key format produced by `monthKeysBetween`: "YYYY-MM" -> the 1st of that month. */
export function monthKeyToDate(key: string): Date {
  const [year, month] = key.split("-").map(Number);
  return new Date(year, month - 1, 1);
}

/** Parses a "YYYY-MM-DD" string as a local calendar date (midnight in
 *  whatever timezone this code runs in) — the inverse of the `ymd()`
 *  formatter in `DateRangeSelect.tsx`. Deliberately not `new Date(str)`:
 *  that parses a bare date as UTC midnight, which displays as the previous
 *  day in any negative-UTC-offset timezone. */
export function parseLocalDay(ymd: string): Date {
  const [year, month, day] = ymd.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/**
 * Converts the calendar days a viewer picked (in their own local time, via
 * `DateRangeSelect`'s "YYYY-MM-DD" strings) into the exact UTC instants
 * bounding that local day. A bare date string carries no timezone, so this
 * is the one place that decides what "that day" means — using whichever
 * clock calls it (the browser, for every real caller) rather than assuming
 * UTC, which would silently exclude a viewer's early-morning records in any
 * positive-UTC-offset timezone.
 */
export function customRangeToQueryBounds(value: {
  key: StatsRangeKey;
  from?: string;
  to?: string;
}): { from?: string; to?: string } {
  if (value.key !== "custom" || !value.from || !value.to) return {};
  const start = parseLocalDay(value.from);
  const end = parseLocalDay(value.to);
  end.setHours(23, 59, 59, 999);
  return { from: start.toISOString(), to: end.toISOString() };
}

/** A single signed contribution to a user's net balance: positive when they
 *  paid, negative when they owed. Caller has already summed same-record
 *  payer/split legs and converted to the group's default currency. */
export type NetLeg = { date: Date; amount: number };

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
export function computeNetTrend(legs: NetLeg[], from: Date | null): NetTrendPoint[] {
  const sorted = [...legs].sort((a, b) => a.date.getTime() - b.date.getTime());
  const points: NetTrendPoint[] = [];
  let running = 0;
  let carried = 0;

  for (const leg of sorted) {
    running += leg.amount;
    const rounded = Math.round(running * 100) / 100;
    if (from && leg.date.getTime() < from.getTime()) {
      carried = rounded;
      continue;
    }
    points.push({ date: leg.date.toISOString(), net: rounded });
  }

  if (from) {
    const anchorDate = from.toISOString();
    const first = points[0];
    if (!first || first.date !== anchorDate) {
      points.unshift({ date: anchorDate, net: carried });
    }
  }

  return points;
}
