/**
 * A record's date is a calendar day with no time and no zone: `YYYY-MM-DD`
 * (`expenses.spent_date`, a Postgres `date`). Everything that handles one goes through
 * here, so nothing derives a day with `toISOString().slice(0, 10)` or reads it back out
 * of a UTC-noon timestamp. Pure and free of server-only imports.
 */

import { DEFAULT_TIME_ZONE } from "./timezone";

export const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Whether `s` is a real calendar day (rejects `2026-02-31` and `2026-13-01`). */
export function isDay(s: unknown): s is string {
  if (typeof s !== "string" || !DAY_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

const dayFormats = new Map<string, Intl.DateTimeFormat>();

/** The calendar day an instant falls on in `timeZone`. */
export function dayInZone(at: Date, timeZone: string): string {
  let f = dayFormats.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    dayFormats.set(timeZone, f);
  }
  return f.format(at);
}

/** Today's day in `timeZone` — the only place a zone decides a record's date. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  return dayInZone(now, timeZone);
}

/** The day a picker's `Date` shows on this device (its local calendar day). */
export function localDateToDay(d: Date): string {
  const y = String(d.getFullYear()).padStart(4, "0");
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

/** A `Date` at local midnight of `day`, for a date picker. */
export function dayToLocalDate(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/**
 * The day of a stored `spentAt`. Audit snapshots written before the column became a date
 * hold an ISO instant instead; those are read as the day in the default zone, which is the
 * zone every group was in then and the one the migration backfilled with. A day passes through.
 */
export function snapshotDay(value: string): string {
  if (DAY_RE.test(value)) return value;
  const at = new Date(value);
  // Not a date at all: hand it back for the caller to show, as the old label did.
  return Number.isNaN(at.getTime()) ? value : dayInZone(at, DEFAULT_TIME_ZONE);
}

/** The day `n` days after `day` (negative for before). Calendar arithmetic, no zone involved. */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
