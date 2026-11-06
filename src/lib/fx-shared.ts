/**
 * Pure FX helpers shared between server code and client components.
 * Must stay free of db / server-only imports.
 */

/**
 * Which currency's records a (base, quote) group rate actually affects:
 * conversion always targets the group default currency, so the affected side
 * is the non-default one. Returns null when the pair doesn't touch the
 * default currency at all (the rate is dormant — nothing is converted by it).
 */
export function affectedCurrencyFor(
  pair: { base: string; quote: string },
  defaultCurrency: string,
): string | null {
  if (pair.quote === defaultCurrency) return pair.base;
  if (pair.base === defaultCurrency) return pair.quote;
  return null;
}

/**
 * The zone in which "which day is this record on" is decided. Fixed, so the answer
 * doesn't depend on where the code runs. A record's `spent_at` is UTC noon of its
 * day (the forms), which is the same calendar day in every zone from UTC-12 to
 * UTC+11.
 */
export const FX_TIME_ZONE = "Asia/Taipei";

const dayFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: FX_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** `YYYY-MM-DD` of an instant in FX_TIME_ZONE. */
export function fxDateKey(d: Date): string {
  return dayFormat.format(d);
}
