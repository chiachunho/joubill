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
