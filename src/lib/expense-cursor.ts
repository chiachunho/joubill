/**
 * Cursor for `GET /api/groups/[id]/expenses`, built and parsed here.
 *
 * The list is ordered by `(spent_date DESC, id DESC)`. The date is user-editable and not
 * unique, so `id` alone would misorder it; the pair is a total order. Within one day the
 * order is `id DESC`, i.e. the order the records were entered in: a date has no time of
 * day to break the tie.
 */

import { isDay } from "./day";

export const EXPENSES_PAGE_SIZE = 30;

/** `expenses.id` is a Postgres int4; a larger one in the query would be a 500, not a 400. */
const MAX_ID = 2_147_483_647;

/** `spentAt` is a `YYYY-MM-DD` day. */
export type ExpenseCursor = { spentAt: string; id: number };

export function encodeExpenseCursor(c: ExpenseCursor): string {
  return `${c.spentAt}_${c.id}`;
}

/** Returns null for anything `encodeExpenseCursor` could not have produced. */
export function parseExpenseCursor(raw: string): ExpenseCursor | null {
  const sep = raw.lastIndexOf("_");
  if (sep < 0) return null;
  const spentAt = raw.slice(0, sep);
  const idText = raw.slice(sep + 1);
  // The shape alone admits 2026-99-99 and Feb 31, which Postgres rejects with a 500.
  if (!isDay(spentAt) || !/^\d+$/.test(idText)) return null;
  const id = Number(idText);
  if (id > MAX_ID) return null;
  return { spentAt, id };
}
