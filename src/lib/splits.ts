import { splitEqual } from "./money";

export type ShareType = "equal" | "exact" | "percent" | "shares" | "adjustment";

export type ParticipantInput = {
  userId: number;
  /** Raw input string: amount for `exact`, percentage for `percent`, share count for
   * `shares`, extra amount for `adjustment`. Ignored for `equal`. */
  value?: string;
};

export type ComputedSplit = { debtorId: number; amount: number };

/**
 * Turn the form's participant inputs into concrete per-debtor amounts.
 *
 *   - equal:      splitEqual divides the total evenly, cent-precise
 *   - exact:      each participant's value is the amount they owe
 *   - percent:    value is a percentage of the total, rounded to the cent
 *   - shares:     value is a share count; amounts are proportional (largest-remainder)
 *   - adjustment: value is an extra amount the person owes on top of the equal base;
 *                 remaining = (total − Σadjustments) is split equally among all
 *
 * Pure: does NOT validate that the result sums to `total` (that's the caller's
 * job — the form shows a live balanced/unbalanced indicator).
 */
export function computeSplits(
  total: number,
  shareType: ShareType,
  participants: ParticipantInput[],
): ComputedSplit[] {
  if (participants.length === 0) return [];

  if (shareType === "equal") {
    const shares = splitEqual(total, participants.length);
    return participants.map((p, i) => ({ debtorId: p.userId, amount: shares[i] }));
  }

  if (shareType === "exact") {
    return participants.map((p) => ({
      debtorId: p.userId,
      amount: parseFloat(p.value ?? "0") || 0,
    }));
  }

  if (shareType === "percent") {
    const pcts = participants.map((p) => parseFloat(p.value ?? "0") || 0);
    const pctSum = pcts.reduce((s, x) => s + x, 0);

    // Largest-remainder method: only when percentages sum to 100% (balanced).
    // Guarantees the sum of rounded amounts equals `total` exactly, avoiding
    // server-side rejection from accumulated per-participant rounding drift.
    // For unbalanced/in-progress inputs, fall back to independent rounding.
    if (Math.abs(pctSum - 100) < 0.005) {
      const totalCents = Math.round(total * 100);
      const rawCents = pcts.map((pct) => (totalCents * pct) / 100);
      const floors = rawCents.map(Math.floor);
      const remainderCents = totalCents - floors.reduce((s, x) => s + x, 0);
      const fracs = rawCents
        .map((r, i) => ({ i, frac: r - floors[i] }))
        .sort((a, b) => b.frac - a.frac);
      for (let k = 0; k < remainderCents; k++) floors[fracs[k].i]++;
      return participants.map((p, i) => ({ debtorId: p.userId, amount: floors[i] / 100 }));
    }

    return participants.map((p, i) => ({
      debtorId: p.userId,
      amount: Math.round(((total * pcts[i]) / 100) * 100) / 100,
    }));
  }

  if (shareType === "shares") {
    const shareNums = participants.map((p) => {
      const v = parseFloat(p.value ?? "");
      return Math.max(Number.isNaN(v) ? 1 : v, 0); // blank/undefined → default 1 share; "0" → 0
    });
    const totalShareCount = shareNums.reduce((s, x) => s + x, 0);
    if (totalShareCount <= 0) return participants.map((p) => ({ debtorId: p.userId, amount: 0 }));
    // Largest-remainder method: guarantees exact cent-precise sum
    const totalCents = Math.round(total * 100);
    const rawCents = shareNums.map((sh) => (totalCents * sh) / totalShareCount);
    const floors = rawCents.map(Math.floor);
    const remainderCents = totalCents - floors.reduce((s, x) => s + x, 0);
    const fracs = rawCents
      .map((r, i) => ({ i, frac: r - floors[i] }))
      .sort((a, b) => b.frac - a.frac);
    for (let k = 0; k < remainderCents; k++) floors[fracs[k].i]++;
    return participants.map((p, i) => ({ debtorId: p.userId, amount: floors[i] / 100 }));
  }

  // adjustment: each person pays their extra amount + an equal slice of the remainder
  const adjustments = participants.map((p) => parseFloat(p.value ?? "0") || 0);
  const totalAdj = adjustments.reduce((s, x) => s + x, 0);
  const baseTotal = total - totalAdj;
  const base = splitEqual(baseTotal, participants.length);
  return participants.map((p, i) => ({
    debtorId: p.userId,
    amount: Math.round((adjustments[i] + base[i]) * 100) / 100,
  }));
}
