import { and, desc, eq, lte } from "drizzle-orm";

import { db } from "@/db";
import { exchangeRates, groupExchangeRates, groups } from "@/db/schema";

import { n } from "./money";

/**
 * Free, no-key currency API hosted on jsdelivr.
 * Source repo: https://github.com/fawazahmed0/exchange-api
 *
 *   - Latest:     <base>@latest/v1/currencies/<base>.json
 *   - Historical: <base>@YYYY-MM-DD/v1/currencies/<base>.json
 *
 * Response format: { date: "YYYY-MM-DD", "<base>": { "<quote>": number, ... } }
 * Currency codes are lowercase in both URL paths and response keys.
 */
const FX_API_BASE = "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api";

type FxResponse = {
  date: string;
  [base: string]: string | Record<string, number>;
};

/**
 * Extract the `base -> quote` rate from a fawazahmed0 API response.
 * Throws if the shape is unexpected or the quote currency is absent.
 * Pure (no network / db) so it can be unit-tested against fixture payloads.
 */
export function parseFxResponse(data: unknown, base: string, quote: string): number {
  const obj = data as FxResponse | null;
  const rates = obj?.[base.toLowerCase()];
  if (!rates || typeof rates !== "object") {
    throw new Error(`FX response missing rates for ${base}`);
  }
  const rate = (rates as Record<string, number>)[quote.toLowerCase()];
  if (typeof rate !== "number") {
    throw new Error(`FX rate not found: ${base}->${quote}`);
  }
  return rate;
}

/** Group custom-rate overrides keyed by `${base}->${quote}` (uppercase codes). */
export type RateOverrides = Map<string, number>;

export function overrideKey(base: string, quote: string): string {
  return `${base.toUpperCase()}->${quote.toUpperCase()}`;
}

/**
 * Build the override map from group_exchange_rates rows. Each explicit pair also
 * yields the inverse pair (1/rate) so users only set a rate once per currency;
 * explicit pairs always win over derived inverses.
 * Pure (no db) so it can be unit-tested.
 */
export function buildOverrideMap(
  rows: Array<{ base: string; quote: string; rate: string | number }>,
): RateOverrides {
  const map: RateOverrides = new Map();
  for (const r of rows) {
    const rate = n(r.rate);
    if (rate > 0) map.set(overrideKey(r.base, r.quote), rate);
  }
  for (const r of rows) {
    const rate = n(r.rate);
    const inv = overrideKey(r.quote, r.base);
    if (rate > 0 && !map.has(inv)) map.set(inv, 1 / rate);
  }
  return map;
}

/** Load a group's custom rates as a RateOverrides map (one query per request). */
export async function loadGroupRateOverrides(groupId: number): Promise<RateOverrides> {
  const rows = await db
    .select({
      base: groupExchangeRates.base,
      quote: groupExchangeRates.quote,
      rate: groupExchangeRates.rate,
    })
    .from(groupExchangeRates)
    .where(eq(groupExchangeRates.groupId, groupId));
  return buildOverrideMap(rows);
}

/**
 * Per-record pinned rate (expenses and settlements share the fx columns):
 * applies only when the stored fx_quote matches the target quote currency
 * (a later default-currency change makes the pin dormant rather than
 * silently wrong). Pure so it can be unit-tested.
 */
export function pinnedRate(
  fx: { fxRate: string | number | null; fxQuote: string | null },
  quote: string,
): number | null {
  if (fx.fxRate == null || fx.fxQuote == null) return null;
  if (fx.fxQuote.toUpperCase() !== quote.toUpperCase()) return null;
  const rate = n(fx.fxRate);
  return Number.isFinite(rate) && rate > 0 ? rate : null;
}

/**
 * Pure form of the fx-column resolution: a pinned rate is only kept when the
 * record currency differs from the group default (a pin against the same
 * currency is meaningless); the quote is stamped from the group default so
 * clients can't pin against an arbitrary currency.
 */
export function fxColumnsFor(
  defaultCurrency: string,
  currency: string,
  fxRate: number | null | undefined,
): { fxRate: string | null; fxQuote: string | null } {
  if (fxRate == null || defaultCurrency === currency) return { fxRate: null, fxQuote: null };
  return { fxRate: String(fxRate), fxQuote: defaultCurrency };
}

/**
 * Resolve the fx columns to store on an expense or settlement from API input,
 * looking up the group's current default currency.
 */
export async function resolveRecordFx(
  groupId: number,
  currency: string,
  fxRate: number | null | undefined,
): Promise<{ fxRate: string | null; fxQuote: string | null }> {
  if (fxRate == null) return { fxRate: null, fxQuote: null };
  const [group] = await db
    .select({ defaultCurrency: groups.defaultCurrency })
    .from(groups)
    .where(eq(groups.id, groupId));
  if (!group) return { fxRate: null, fxQuote: null };
  return fxColumnsFor(group.defaultCurrency, currency, fxRate);
}

/**
 * Resolve a rate to convert `base` into `quote` on a given date.
 *
 * Lookup strategy:
 *   1. Group custom rate from `overrides` (date-independent — the group agreed
 *      on one fixed rate), when provided.
 *   2. Most recent cached rate with as_of_date <= date (FX doesn't move overnight,
 *      and the API itself returns Friday's rate on weekends — handled naturally
 *      by the `<=` window).
 *   3. Cache miss → fetch from API, cache by the API's response date, return.
 */
export async function getRate(
  base: string,
  quote: string,
  date: Date,
  overrides?: RateOverrides,
): Promise<number> {
  const b = base.toUpperCase();
  const q = quote.toUpperCase();
  if (b === q) return 1;

  const override = overrides?.get(overrideKey(b, q));
  if (override != null) return override;

  const dateStr = date.toISOString().slice(0, 10);

  const [cached] = await db
    .select({ rate: exchangeRates.rate })
    .from(exchangeRates)
    .where(
      and(
        eq(exchangeRates.base, b),
        eq(exchangeRates.quote, q),
        lte(exchangeRates.asOfDate, dateStr),
      ),
    )
    .orderBy(desc(exchangeRates.asOfDate))
    .limit(1);
  if (cached) return n(cached.rate);

  const today = new Date().toISOString().slice(0, 10);
  const datePath = dateStr >= today ? "latest" : dateStr;
  const url = `${FX_API_BASE}@${datePath}/v1/currencies/${b.toLowerCase()}.json`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`FX fetch failed (${res.status}): ${url}`);
  }
  const data = (await res.json()) as FxResponse;
  const rate = parseFxResponse(data, b, q);

  await db
    .insert(exchangeRates)
    .values({
      base: b,
      quote: q,
      rate: rate.toString(),
      asOfDate: data.date,
    })
    .onConflictDoNothing();

  return rate;
}

/**
 * The full rate-resolution priority chain for one record (expense or
 * settlement leg): per-record pinned rate > group custom rate (overrides) >
 * cached market rate as of the record's own date. All balance/stats
 * conversions must go through this so the priority order lives in one place.
 */
export async function resolveRate(
  record: { currency: string; fxRate: string | number | null; fxQuote: string | null },
  quote: string,
  at: Date,
  overrides?: RateOverrides,
): Promise<number> {
  return pinnedRate(record, quote) ?? getRate(record.currency, quote, at, overrides);
}
