/**
 * Read-only impact report for the market-rate fix (issue #140): how much would each
 * member's balance move once `getRate` stops reusing an old cached rate?
 *
 *   pnpm fx:impact
 *
 * Only records that convert at a market rate are compared (no applicable per-record pin,
 * no group custom rate). The old rate is the newest cached row on or before the record's
 * day; the new one is the cache when it is within the tolerance, else that day's rate from
 * the API. Nothing is written, neither to the database nor to the rate cache.
 */
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

async function main() {
  // Loaded after dotenv: `@/db` reads DATABASE_URL when it is first imported.
  const { db } = await import("../src/db/index.js");
  const { and, desc, eq, lte } = await import("drizzle-orm");
  const { exchangeRates, expensePayers, expenseSplits, expenses, groups } =
    await import("../src/db/schema.js");
  const fx = await import("../src/lib/fx.js");
  const { n } = await import("../src/lib/money.js");

  const apiCache = new Map<string, number>();
  const oldCache = new Map<string, { rate: number; asOfDate: string } | null>();
  const today = fx.fxDateKey(new Date());

  async function oldRate(b: string, q: string, day: string) {
    const key = `${b}|${q}|${day}`;
    if (oldCache.has(key)) return oldCache.get(key) ?? null;
    const [row] = await db
      .select({ rate: exchangeRates.rate, asOfDate: exchangeRates.asOfDate })
      .from(exchangeRates)
      .where(
        and(
          eq(exchangeRates.base, b),
          eq(exchangeRates.quote, q),
          lte(exchangeRates.asOfDate, day),
        ),
      )
      .orderBy(desc(exchangeRates.asOfDate))
      .limit(1);
    const out = row ? { rate: n(row.rate), asOfDate: row.asOfDate } : null;
    oldCache.set(key, out);
    return out;
  }

  async function newRate(b: string, q: string, day: string) {
    const old = await oldRate(b, q, day);
    if (old && fx.pickCachedRate([old], day)) return old.rate;
    const key = `${b}|${q}|${day}`;
    if (!apiCache.has(key)) {
      const path = day >= today ? "latest" : day;
      const res = await fetch(`${fx.FX_API_BASE}@${path}/v1/currencies/${b.toLowerCase()}.json`);
      if (!res.ok) throw new Error(`FX fetch failed (${res.status}) for ${key}`);
      apiCache.set(key, fx.parseFxResponse(await res.json(), b, q));
    }
    return apiCache.get(key)!;
  }

  const allGroups = await db
    .select({ id: groups.id, title: groups.title, defaultCurrency: groups.defaultCurrency })
    .from(groups);

  let changedGroups = 0;
  for (const g of allGroups) {
    const overrides = await fx.loadGroupRateOverrides(g.id);
    const recs = await db
      .select({
        id: expenses.id,
        currency: expenses.currency,
        fxRate: expenses.fxRate,
        fxQuote: expenses.fxQuote,
        spentAt: expenses.spentAt,
      })
      .from(expenses)
      .where(eq(expenses.groupId, g.id));

    const delta = new Map<number, number>();
    let touched = 0;
    for (const r of recs) {
      if (r.currency === g.defaultCurrency) continue;
      if (fx.pinnedRate(r, g.defaultCurrency) != null) continue;
      if (overrides.has(fx.overrideKey(r.currency, g.defaultCurrency))) continue;
      const day = fx.fxDateKey(r.spentAt);
      const o = await oldRate(r.currency, g.defaultCurrency, day);
      const nw = await newRate(r.currency, g.defaultCurrency, day);
      const diff = nw - (o?.rate ?? nw);
      if (Math.abs(diff) < 1e-12) continue;
      touched++;
      const [payers, splits] = await Promise.all([
        db.select().from(expensePayers).where(eq(expensePayers.expenseId, r.id)),
        db.select().from(expenseSplits).where(eq(expenseSplits.expenseId, r.id)),
      ]);
      for (const p of payers)
        delta.set(p.payerId, (delta.get(p.payerId) ?? 0) + n(p.amount) * diff);
      for (const s of splits)
        delta.set(s.debtorId, (delta.get(s.debtorId) ?? 0) - n(s.amount) * diff);
    }
    if (touched === 0) continue;
    changedGroups++;
    console.log(`\nGroup ${g.id} "${g.title}" (${g.defaultCurrency}): ${touched} record(s) change`);
    for (const [userId, d] of [...delta].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))) {
      console.log(`  user ${userId}: ${d >= 0 ? "+" : ""}${d.toFixed(2)}`);
    }
  }
  console.log(`\n${changedGroups} of ${allGroups.length} group(s) would change.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
