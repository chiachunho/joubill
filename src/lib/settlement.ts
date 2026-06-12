import { eq } from "drizzle-orm";

import { db } from "@/db";
import { expensePayers, expenseSplits, expenses, settlements } from "@/db/schema";

import { loadGroupRateOverrides, resolveRate } from "./fx";
import { n } from "./money";
import type { NetBalance } from "./settlement-core";

export type { NetBalance, Transfer } from "./settlement-core";
export { minimizeTransfers } from "./settlement-core";

const EPSILON = 0.005;

/**
 * Compute net balances for every user in the group, normalised to `quoteCurrency`.
 *
 *   net(user) = sum(paid)
 *             - sum(owed)
 *             - sum(received via settlement)
 *             + sum(paid via settlement)
 *
 * Each leg is multiplied by the FX rate from its own currency to `quoteCurrency`,
 * using the FX rate as of `spent_at` / `settled_at` (so historical expenses don't
 * silently rewrite history when rates move). Rate priority per expense leg:
 * pinned per-expense rate > group custom rate > cached market rate.
 */
export async function computeGroupBalances(
  groupId: number,
  quoteCurrency: string,
): Promise<NetBalance[]> {
  const balances = new Map<number, number>();
  const bump = (uid: number, delta: number) => balances.set(uid, (balances.get(uid) ?? 0) + delta);
  const overrides = await loadGroupRateOverrides(groupId);

  const paidRows = await db
    .select({
      payerId: expensePayers.payerId,
      amount: expensePayers.amount,
      currency: expenses.currency,
      spentAt: expenses.spentAt,
      fxRate: expenses.fxRate,
      fxQuote: expenses.fxQuote,
    })
    .from(expensePayers)
    .innerJoin(expenses, eq(expenses.id, expensePayers.expenseId))
    .where(eq(expenses.groupId, groupId));
  for (const r of paidRows) {
    const rate = await resolveRate(r, quoteCurrency, r.spentAt, overrides);
    bump(r.payerId, n(r.amount) * rate);
  }

  const owedRows = await db
    .select({
      debtorId: expenseSplits.debtorId,
      amount: expenseSplits.amount,
      currency: expenses.currency,
      spentAt: expenses.spentAt,
      fxRate: expenses.fxRate,
      fxQuote: expenses.fxQuote,
    })
    .from(expenseSplits)
    .innerJoin(expenses, eq(expenses.id, expenseSplits.expenseId))
    .where(eq(expenses.groupId, groupId));
  for (const r of owedRows) {
    const rate = await resolveRate(r, quoteCurrency, r.spentAt, overrides);
    bump(r.debtorId, -n(r.amount) * rate);
  }

  const settled = await db
    .select({
      from: settlements.fromUserId,
      to: settlements.toUserId,
      amount: settlements.amount,
      currency: settlements.currency,
      settledAt: settlements.settledAt,
      fxRate: settlements.fxRate,
      fxQuote: settlements.fxQuote,
    })
    .from(settlements)
    .where(eq(settlements.groupId, groupId));
  for (const r of settled) {
    const rate = await resolveRate(r, quoteCurrency, r.settledAt, overrides);
    bump(r.from, n(r.amount) * rate);
    bump(r.to, -n(r.amount) * rate);
  }

  return Array.from(balances.entries())
    .map(([userId, amount]) => ({ userId, amount: Math.round(amount * 100) / 100 }))
    .filter((b) => Math.abs(b.amount) >= EPSILON);
}

