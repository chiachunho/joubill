/** Preset windows for the stats page; "custom" requires explicit from/to. */
export type StatsRangeKey = "3m" | "6m" | "1y" | "all" | "custom";

export type ResolvedRange = {
  /** Inclusive lower bound. Null only for "all" — the caller resolves that to
   *  the group's earliest record, since stats-core has no DB access. */
  from: Date | null;
  /** Inclusive upper bound. */
  to: Date;
};

/**
 * Resolves a range key (+ optional custom bounds, "YYYY-MM-DD") to concrete
 * from/to dates. Pure — no DB, no "now" side effect (caller passes `now`).
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
    const from = new Date(`${customFrom}T00:00:00.000Z`);
    const to = new Date(`${customTo}T23:59:59.999Z`);
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
  return { from, to: now };
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

/** Inverse of the key format produced by `monthKeysBetween`: "YYYY-MM" -> the 1st of that month. */
export function monthKeyToDate(key: string): Date {
  const [year, month] = key.split("-").map(Number);
  return new Date(year, month - 1, 1);
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
