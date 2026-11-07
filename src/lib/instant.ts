/**
 * Whether two timestamps are the same instant as far as a JS `Date` can tell: the database
 * column holds microseconds, a `Date` and its ISO string keep milliseconds, so a value that
 * made the round trip differs from the stored one by under a millisecond. Shared by the
 * records layer's stale-edit check and `update_record`'s early one, so the two can't
 * disagree about what "changed since" means.
 */
export function sameInstant(a: Date, b: Date): boolean {
  return Math.abs(a.getTime() - b.getTime()) < 2;
}
