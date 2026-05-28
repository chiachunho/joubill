import { and, desc, eq, lte } from "drizzle-orm";

import { db } from "@/db";
import { exchangeRates } from "@/db/schema";

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
 * Resolve a rate to convert `base` into `quote` on a given date.
 *
 * Lookup strategy:
 *   1. Most recent cached rate with as_of_date <= date (FX doesn't move overnight,
 *      and the API itself returns Friday's rate on weekends — handled naturally
 *      by the `<=` window).
 *   2. Cache miss → fetch from API, cache by the API's response date, return.
 */
export async function getRate(base: string, quote: string, date: Date): Promise<number> {
  const b = base.toUpperCase();
  const q = quote.toUpperCase();
  if (b === q) return 1;

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
  const rates = data[b.toLowerCase()];
  if (!rates || typeof rates !== "object") {
    throw new Error(`FX response missing rates for ${b} at ${dateStr}`);
  }
  const rate = rates[q.toLowerCase()];
  if (typeof rate !== "number") {
    throw new Error(`FX rate not found: ${b}->${q} at ${dateStr}`);
  }

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
