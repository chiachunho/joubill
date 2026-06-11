import { and, eq, inArray, isNull, ne, or } from "drizzle-orm";

import { db } from "@/db";
import { expenses, settlements } from "@/db/schema";

import { getRate, type RateOverrides } from "./fx";

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Which currency's records a (base, quote) group rate actually affects:
 * conversion always targets the group default currency, so the affected side
 * is the non-default one. Returns null when the pair doesn't touch the
 * default currency at all (the rate is dormant — nothing to lock).
 */
export function affectedCurrencyFor(
  pair: { base: string; quote: string },
  defaultCurrency: string,
): string | null {
  if (pair.quote === defaultCurrency) return pair.base;
  if (pair.base === defaultCurrency) return pair.quote;
  return null;
}

type IdsByRate = Array<{ ids: number[]; rate: string }>;

export type RateLockPlan = {
  quote: string;
  expenseUpdates: IdsByRate;
  settlementUpdates: IdsByRate;
  lockedExpenses: number;
  lockedSettlements: number;
};

/**
 * Resolve the pins needed to freeze every record (expense + settlement) in
 * `currency` at its CURRENT effective rate against `quote` — the group rate
 * from `overrides` or the per-day market rate. Records with an applicable pin
 * are left alone; dormant pins get overwritten. Run this BEFORE changing or
 * deleting the group rate (network/cache lookups happen here, not inside the
 * write transaction). Throws when a market rate can't be resolved.
 */
export async function planRateLock(
  groupId: number,
  currency: string,
  quote: string,
  overrides: RateOverrides,
): Promise<RateLockPlan> {
  const [expenseRows, settlementRows] = await Promise.all([
    db
      .select({ id: expenses.id, at: expenses.spentAt })
      .from(expenses)
      .where(
        and(
          eq(expenses.groupId, groupId),
          eq(expenses.currency, currency),
          or(isNull(expenses.fxRate), isNull(expenses.fxQuote), ne(expenses.fxQuote, quote)),
        ),
      ),
    db
      .select({ id: settlements.id, at: settlements.settledAt })
      .from(settlements)
      .where(
        and(
          eq(settlements.groupId, groupId),
          eq(settlements.currency, currency),
          or(
            isNull(settlements.fxRate),
            isNull(settlements.fxQuote),
            ne(settlements.fxQuote, quote),
          ),
        ),
      ),
  ]);

  const rateByDay = new Map<string, number>();
  async function rateFor(at: Date): Promise<number> {
    const day = at.toISOString().slice(0, 10);
    let r = rateByDay.get(day);
    if (r === undefined) {
      r = await getRate(currency, quote, at, overrides);
      rateByDay.set(day, r);
    }
    return r;
  }

  async function groupByRate(rows: Array<{ id: number; at: Date }>): Promise<IdsByRate> {
    const idsByRate = new Map<string, number[]>();
    for (const row of rows) {
      const key = String(await rateFor(row.at));
      const ids = idsByRate.get(key) ?? [];
      ids.push(row.id);
      idsByRate.set(key, ids);
    }
    return Array.from(idsByRate.entries()).map(([rate, ids]) => ({ ids, rate }));
  }

  return {
    quote,
    expenseUpdates: await groupByRate(expenseRows),
    settlementUpdates: await groupByRate(settlementRows),
    lockedExpenses: expenseRows.length,
    lockedSettlements: settlementRows.length,
  };
}

/** Write the pins from a plan. Call inside the same transaction as the rate change. */
export async function applyRateLock(tx: DbTransaction, plan: RateLockPlan): Promise<void> {
  for (const u of plan.expenseUpdates) {
    await tx
      .update(expenses)
      .set({ fxRate: u.rate, fxQuote: plan.quote, updatedAt: new Date() })
      .where(inArray(expenses.id, u.ids));
  }
  for (const u of plan.settlementUpdates) {
    await tx
      .update(settlements)
      .set({ fxRate: u.rate, fxQuote: plan.quote })
      .where(inArray(settlements.id, u.ids));
  }
}
