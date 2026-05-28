import { splitEqual } from "./money";

export type ShareType = "equal" | "exact" | "percent";

export type ParticipantInput = {
  userId: number;
  /** Raw input string: amount for `exact`, percentage for `percent`. Ignored for `equal`. */
  value?: string;
};

export type ComputedSplit = { debtorId: number; amount: number };

/**
 * Turn the form's participant inputs into concrete per-debtor amounts.
 *
 *   - equal:   splitEqual divides the total evenly, cent-precise
 *   - exact:   each participant's value is the amount they owe
 *   - percent: value is a percentage of the total, rounded to the cent
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

  // percent
  return participants.map((p) => {
    const pct = parseFloat(p.value ?? "0") || 0;
    return { debtorId: p.userId, amount: Math.round(((total * pct) / 100) * 100) / 100 };
  });
}
