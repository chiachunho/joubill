/** Net balance per user. Positive = creditor (others owe them). */
export type NetBalance = { userId: number; amount: number };

/** A single transfer suggestion: `from` owes `to` this amount. */
export type Transfer = { fromUserId: number; toUserId: number; amount: number };

/**
 * Up to this many people with a non-zero balance get the exact (minimum)
 * answer. The subset DP needs `2^n` states, so 20 is about a million entries.
 * Beyond it we fall back to the greedy method.
 */
export const MAX_EXACT_PEOPLE = 20;

/**
 * A balance of this many cents or fewer counts as settled. Rounding the
 * residual onto someone (below) can leave a person 1–2 cents off their exact
 * figure; without this, paying the suggestion exactly would make the next
 * `/settle` ask for a 0.01 transfer back.
 */
export const DUST_CENTS = 2;

type Cents = { userId: number; cents: number };

/** Largest amount first, then by user id, so the same input gives the same answer. */
function byMagnitude(a: Cents, b: Cents): number {
  return Math.abs(b.cents) - Math.abs(a.cents) || a.userId - b.userId;
}

/**
 * Integer-cent balances that sum to exactly 0, or fewer people if some round
 * away.
 *
 * Balances are floats after FX conversion, so rounding each one to cents can
 * leave the total a few cents off, and then no subset would ever sum to 0.
 * The residual is moved onto the people with the largest balances, one cent
 * each per pass, because that distorts them least in relative terms. Nobody is
 * pushed down into the dust band or across zero.
 */
function toBalancedCents(balances: NetBalance[]): Cents[] {
  const people: Cents[] = balances
    .map((b) => ({ userId: b.userId, cents: Math.round(b.amount * 100) }))
    .filter((p) => Math.abs(p.cents) > DUST_CENTS)
    .sort(byMagnitude);

  let residual = people.reduce((s, p) => s + p.cents, 0);
  while (residual !== 0) {
    const step = residual > 0 ? -1 : 1;
    let moved = false;
    for (const p of people) {
      if (residual === 0) break;
      // Never shrink someone into the dust band (or across zero): they would be
      // settled by the rule above, or asked for a 0.01 transfer.
      if (Math.abs(p.cents + step) <= DUST_CENTS) continue;
      p.cents += step;
      residual += step;
      moved = true;
    }
    if (!moved) break;
  }
  return people.filter((p) => p.cents !== 0);
}

/** Greedy: the biggest debtor pays the biggest creditor. Exact in integer cents. */
function greedy(people: Cents[]): Transfer[] {
  const creditors = people
    .filter((p) => p.cents > 0)
    .map((p) => ({ ...p }))
    .sort(byMagnitude);
  const debtors = people
    .filter((p) => p.cents < 0)
    .map((p) => ({ userId: p.userId, cents: -p.cents }))
    .sort(byMagnitude);

  const transfers: Transfer[] = [];
  let i = 0;
  let j = 0;
  while (i < creditors.length && j < debtors.length) {
    const c = creditors[i];
    const d = debtors[j];
    const t = Math.min(c.cents, d.cents);
    transfers.push({ fromUserId: d.userId, toUserId: c.userId, amount: t / 100 });
    c.cents -= t;
    d.cents -= t;
    if (c.cents === 0) i++;
    if (d.cents === 0) j++;
  }
  return transfers;
}

/**
 * Split people into the largest possible number of groups that each sum to 0.
 *
 * `dp[mask]` is the most zero-sum groups the people in `mask` can be cut into:
 * remove one person, take the best of the rest, and add one if the whole mask
 * sums to 0. `parent[mask]` remembers who was removed. Walking that chain from
 * the full set gives an order in which every prefix that sums to 0 ends a group.
 */
function zeroSumGroups(people: Cents[]): Cents[][] {
  const n = people.length;
  const size = 1 << n;
  const sum = new Float64Array(size);
  const dp = new Uint8Array(size);
  const parent = new Int8Array(size);

  for (let mask = 1; mask < size; mask++) {
    const low = mask & -mask;
    sum[mask] = sum[mask ^ low] + people[31 - Math.clz32(low)].cents;
    let best = -1;
    let who = 0;
    for (let i = 0; i < n; i++) {
      if (!(mask & (1 << i))) continue;
      const v = dp[mask ^ (1 << i)];
      if (v > best) {
        best = v;
        who = i;
      }
    }
    dp[mask] = best + (sum[mask] === 0 ? 1 : 0);
    parent[mask] = who;
  }

  const removed: number[] = [];
  for (let mask = size - 1; mask; mask ^= 1 << parent[mask]) removed.push(parent[mask]);

  const groups: Cents[][] = [];
  let current: Cents[] = [];
  let running = 0;
  for (const i of removed.reverse()) {
    current.push(people[i]);
    running += people[i].cents;
    if (running === 0) {
      groups.push(current);
      current = [];
    }
  }
  if (current.length) groups.push(current);
  return groups;
}

/**
 * Fewest transfers that settle everyone.
 *
 * With k people who are not square, the best possible is `k − g`, where g is
 * the most groups that can each settle among themselves (sum to 0): a group of
 * m people needs m − 1 transfers, and a group that cannot be split further
 * cannot do better. So the work is finding g (`zeroSumGroups`, exact up to
 * `MAX_EXACT_PEOPLE` people) and settling each group greedily, which gives
 * exactly m − 1 there.
 *
 * Amounts are worked out in integer cents; see `toBalancedCents` for how the
 * rounding residual and sub-2-cent balances are handled. Above the limit the
 * answer is the plain greedy one: at most k − 1 transfers, not always minimal.
 */
export function minimizeTransfers(balances: NetBalance[]): Transfer[] {
  const people = toBalancedCents(balances);
  const transfers =
    people.length > MAX_EXACT_PEOPLE
      ? greedy(people)
      : zeroSumGroups(people).flatMap((group) => greedy(group));

  return transfers.sort(
    (a, b) => b.amount - a.amount || a.fromUserId - b.fromUserId || a.toUserId - b.toUserId,
  );
}
