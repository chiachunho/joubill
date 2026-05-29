/** Net balance per user. Positive = creditor (others owe them). */
export type NetBalance = { userId: number; amount: number };

/** A single transfer suggestion: `from` owes `to` this amount. */
export type Transfer = { fromUserId: number; toUserId: number; amount: number };

const EPSILON = 0.005;

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
