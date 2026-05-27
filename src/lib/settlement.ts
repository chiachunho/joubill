import { eq } from "drizzle-orm";

import { db } from "@/db";
import { expenseSplits, expenses, settlements } from "@/db/schema";

import { n } from "./money";

/** Net balance per user. Positive = creditor (others owe them). */
export type NetBalance = { userId: number; amount: number };

/** A single transfer suggestion: `from` owes `to` this amount. */
export type Transfer = { fromUserId: number; toUserId: number; amount: number };

const EPSILON = 0.005;

/**
 * Compute net balances for every user that has any activity in the group.
 *
 *   net(user) = sum(paid in expenses)
 *             - sum(owed in expense_splits)
 *             - sum(received via settlement)
 *             + sum(paid via settlement)
 *
 * MVP assumption: all amounts are already in the same currency. FX normalisation
 * lives in C6.
 */
export async function computeGroupBalances(groupId: number): Promise<NetBalance[]> {
  const balances = new Map<number, number>();
  const bump = (uid: number, delta: number) => balances.set(uid, (balances.get(uid) ?? 0) + delta);

  const paidRows = await db
    .select({ payerId: expenses.payerId, amount: expenses.amount })
    .from(expenses)
    .where(eq(expenses.groupId, groupId));
  for (const r of paidRows) bump(r.payerId, n(r.amount));

  const owedRows = await db
    .select({ debtorId: expenseSplits.debtorId, amount: expenseSplits.amount })
    .from(expenseSplits)
    .innerJoin(expenses, eq(expenses.id, expenseSplits.expenseId))
    .where(eq(expenses.groupId, groupId));
  for (const r of owedRows) bump(r.debtorId, -n(r.amount));

  const settled = await db
    .select({
      from: settlements.fromUserId,
      to: settlements.toUserId,
      amount: settlements.amount,
    })
    .from(settlements)
    .where(eq(settlements.groupId, groupId));
  for (const r of settled) {
    bump(r.from, n(r.amount));
    bump(r.to, -n(r.amount));
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
