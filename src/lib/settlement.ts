import { eq } from "drizzle-orm";

import { db } from "@/db";
import { expenseSplits, expenses, settlements } from "@/db/schema";

import { getRate } from "./fx";
import { n } from "./money";

/** Net balance per user. Positive = creditor (others owe them). */
export type NetBalance = { userId: number; amount: number };

/** A single transfer suggestion: `from` owes `to` this amount. */
export type Transfer = { fromUserId: number; toUserId: number; amount: number };

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
 * silently rewrite history when rates move).
 */
export async function computeGroupBalances(
  groupId: number,
  quoteCurrency: string,
): Promise<NetBalance[]> {
  const balances = new Map<number, number>();
  const bump = (uid: number, delta: number) => balances.set(uid, (balances.get(uid) ?? 0) + delta);

  const paidRows = await db
    .select({
      payerId: expenses.payerId,
      amount: expenses.amount,
      currency: expenses.currency,
      spentAt: expenses.spentAt,
    })
    .from(expenses)
    .where(eq(expenses.groupId, groupId));
  for (const r of paidRows) {
    const rate = await getRate(r.currency, quoteCurrency, r.spentAt);
    bump(r.payerId, n(r.amount) * rate);
  }

  const owedRows = await db
    .select({
      debtorId: expenseSplits.debtorId,
      amount: expenseSplits.amount,
      currency: expenses.currency,
      spentAt: expenses.spentAt,
    })
    .from(expenseSplits)
    .innerJoin(expenses, eq(expenses.id, expenseSplits.expenseId))
    .where(eq(expenses.groupId, groupId));
  for (const r of owedRows) {
    const rate = await getRate(r.currency, quoteCurrency, r.spentAt);
    bump(r.debtorId, -n(r.amount) * rate);
  }

  const settled = await db
    .select({
      from: settlements.fromUserId,
      to: settlements.toUserId,
      amount: settlements.amount,
      currency: settlements.currency,
      settledAt: settlements.settledAt,
    })
    .from(settlements)
    .where(eq(settlements.groupId, groupId));
  for (const r of settled) {
    const rate = await getRate(r.currency, quoteCurrency, r.settledAt);
    bump(r.from, n(r.amount) * rate);
    bump(r.to, -n(r.amount) * rate);
  }

  return Array.from(balances.entries())
    .map(([userId, amount]) => ({ userId, amount: Math.round(amount * 100) / 100 }))
    .filter((b) => Math.abs(b.amount) >= EPSILON);
}

/**
 * Greedy minimum-transfer settlement: at each step, pair the largest creditor
 * with the largest debtor. Not provably optimal in the worst case (the general
 * problem is NP-hard), but matches Splitwise's behaviour and produces optimal
 * results for typical group sizes.
 */
export function minimizeTransfers(balances: NetBalance[]): Transfer[] {
  const creditors = balances
    .filter((b) => b.amount > EPSILON)
    .map((b) => ({ userId: b.userId, amount: b.amount }))
    .sort((a, b) => b.amount - a.amount);
  const debtors = balances
    .filter((b) => b.amount < -EPSILON)
    .map((b) => ({ userId: b.userId, amount: -b.amount }))
    .sort((a, b) => b.amount - a.amount);

  const transfers: Transfer[] = [];
  let i = 0;
  let j = 0;
  while (i < creditors.length && j < debtors.length) {
    const c = creditors[i];
    const d = debtors[j];
    const t = Math.min(c.amount, d.amount);
    transfers.push({
      fromUserId: d.userId,
      toUserId: c.userId,
      amount: Math.round(t * 100) / 100,
    });
    c.amount -= t;
    d.amount -= t;
    if (c.amount < EPSILON) i++;
    if (d.amount < EPSILON) j++;
  }
  return transfers;
}
