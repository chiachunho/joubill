import { and, type AnyColumn, eq, inArray, isNull, ne, or } from "drizzle-orm";

import { db } from "@/db";
import { expenses } from "@/db/schema";

import { getRate, type RateOverrides } from "./fx";

export { affectedCurrencyFor } from "./fx-shared";

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * SQL condition for "this record has no pin that applies against `quote`":
 * no pin at all, or a dormant pin stamped for a different quote currency.
 * Single source of truth for both the lock queries and the affected-record
 * counts in the rates API — keep them counting the same set.
 */
export function noApplicablePin(
  cols: { fxRate: AnyColumn; fxQuote: AnyColumn },
  quote: string,
) {
  return or(isNull(cols.fxRate), isNull(cols.fxQuote), ne(cols.fxQuote, quote));
}

type IdsByRate = Array<{ ids: number[]; rate: string }>;

export type RateLockPlan = {
  /** The currency whose records are being pinned. */
  base: string;
  quote: string;
  expenseUpdates: IdsByRate;
  settlementUpdates: IdsByRate;
  lockedExpenses: number;
  lockedSettlements: number;
};

/** Every record id a plan will rewrite, split by kind — for the audit log. */
export function lockedIds(plan: RateLockPlan): {
  expenseIds: number[];
  settlementIds: number[];
} {
  return {
    expenseIds: plan.expenseUpdates.flatMap((u) => u.ids),
    settlementIds: plan.settlementUpdates.flatMap((u) => u.ids),
  };
}

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
  // Both real expenses and repayments live in `expenses`; `type` tells them
  // apart so the rates UI can keep reporting the two counts separately.
  const [expenseRows, settlementRows] = await Promise.all([
    db
      .select({ id: expenses.id, at: expenses.spentAt })
      .from(expenses)
      .where(
        and(
          eq(expenses.groupId, groupId),
          eq(expenses.type, "expense"),
          eq(expenses.currency, currency),
          noApplicablePin(expenses, quote),
        ),
      ),
    db
      .select({ id: expenses.id, at: expenses.spentAt })
      .from(expenses)
      .where(
        and(
          eq(expenses.groupId, groupId),
          eq(expenses.type, "settlement"),
          eq(expenses.currency, currency),
          noApplicablePin(expenses, quote),
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
    base: currency,
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
      .update(expenses)
      .set({ fxRate: u.rate, fxQuote: plan.quote, updatedAt: new Date() })
      .where(inArray(expenses.id, u.ids));
  }
}
