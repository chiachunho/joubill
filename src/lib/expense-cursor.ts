/**
 * Cursor for `GET /api/groups/[id]/expenses`, built and parsed here.
 *
 * The list is ordered by `(spent_at DESC, id DESC)`. `spent_at` is user-editable
 * and not unique, so `id` alone would misorder it; the pair is a total order.
 * The timestamp travels at the database's full microsecond precision as text —
 * a JS `Date` stops at milliseconds, and a cursor rounded down would skip the
 * rows that share its millisecond.
 */

export const EXPENSES_PAGE_SIZE = 30;

/** `expenses.id` is a Postgres int4; a larger one in the query would be a 500, not a 400. */
const MAX_ID = 2_147_483_647;

export type ExpenseCursor = { spentAt: string; id: number };

const SPENT_AT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

export function encodeExpenseCursor(c: ExpenseCursor): string {
  return `${c.spentAt}_${c.id}`;
}

/** Returns null for anything `encodeExpenseCursor` could not have produced. */
export function parseExpenseCursor(raw: string): ExpenseCursor | null {
  const sep = raw.lastIndexOf("_");
  if (sep < 0) return null;
  const spentAt = raw.slice(0, sep);
  const idText = raw.slice(sep + 1);
  if (!SPENT_AT_RE.test(spentAt) || !/^\d+$/.test(idText)) return null;
  // The shape alone admits 2026-99-99 and Feb 31, which Postgres rejects with a 500.
  const parsed = new Date(`${spentAt.slice(0, 23)}Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 19) !== spentAt.slice(0, 19)
  ) {
    return null;
  }
  const id = Number(idText);
  if (id > MAX_ID) return null;
  return { spentAt, id };
}
