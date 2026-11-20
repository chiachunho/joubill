/**
 * Pure refund math (issue #178). A refund is stored as a `type='refund'` expense whose
 * payers are the people it is shared back to and whose sole split is the person who
 * received it, so its balance effect is exactly "the parent cost less". Everything here
 * is in the refund's own currency; ratios don't depend on currency.
 */

export type RefundShare = { userId: number; amount: number };

/**
 * Shares `amount` out in proportion to `weights` (the parent's split amounts), in whole
 * cents, by largest remainder with ties broken by user id, so the parts always sum to
 * `amount` exactly and the same input always gives the same rows. People whose part
 * rounds to 0 are left out: a payer row of 0 says nothing.
 */
export function ratioShares(amount: number, weights: RefundShare[]): RefundShare[] {
  const positive = weights.filter((w) => w.amount > 0);
  const total = positive.reduce((s, w) => s + w.amount, 0);
  const cents = Math.round(amount * 100);
  if (positive.length === 0 || total <= 0 || cents <= 0) return [];

  const raw = positive.map((w) => ({ userId: w.userId, exact: (cents * w.amount) / total }));
  const parts = raw.map((r) => ({ userId: r.userId, cents: Math.floor(r.exact + 1e-9) }));
  let left = cents - parts.reduce((s, p) => s + p.cents, 0);
  const order = raw
    .map((r, i) => ({ i, rem: r.exact - parts[i].cents, userId: r.userId }))
    .sort((a, b) => b.rem - a.rem || a.userId - b.userId);
  for (const o of order) {
    if (left <= 0) break;
    parts[o.i].cents += 1;
    left -= 1;
  }
  return parts
    .filter((p) => p.cents > 0)
    .map((p) => ({ userId: p.userId, amount: p.cents / 100 }))
    .sort((a, b) => a.userId - b.userId);
}

/** Custom shares as stored: zero amounts dropped, rounded to cents. */
export function customShares(shares: RefundShare[]): RefundShare[] {
  return shares
    .map((s) => ({ userId: s.userId, amount: Math.round(s.amount * 100) / 100 }))
    .filter((s) => s.amount > 0);
}

/** "退稅": what a refund is called everywhere a person reads it. */
export const REFUND_LABEL = "退稅";

/** The description a new refund starts with: "藥妝 退稅", or just "退稅". */
export function defaultRefundDescription(parentDescription: string | null | undefined): string {
  const d = parentDescription?.trim();
  return d ? `${d} ${REFUND_LABEL}` : REFUND_LABEL;
}
