import type { McpPayer, McpSplit } from "@/lib/mcp-split";

/**
 * What an edit keeps when the agent changes only some fields (issue #152). `update_record`
 * overlays the arguments on the stored record; payers and splits the agent didn't mention
 * must survive, and survive *correctly* when the total moves. Pure, so the rules that would
 * otherwise quietly rewrite a split are tested.
 */

export type StoredPayer = { memberId: number; amount: number };
export type StoredSplit = {
  memberId: number;
  amount: number;
  shareType: string;
  weight: number | null;
};

export type Carried<T> = { ok: true; value: T } | { ok: false; message: string };

/** The payers to keep. One payer follows the new total; several can't be rescaled by guessing. */
export function carryOverPayers(
  stored: readonly StoredPayer[],
  amountChanged: boolean,
): Carried<McpPayer[]> {
  if (stored.length === 1) return { ok: true, value: [{ userId: stored[0].memberId }] };
  if (!amountChanged) {
    return {
      ok: true,
      value: stored.map((p) => ({ userId: p.memberId, amount: p.amount })),
    };
  }
  return {
    ok: false,
    message:
      "The amount changed on a record with several payers. Send payers with the new amounts (they must add up to the total).",
  };
}

/**
 * The split to keep. Equal and share splits are recomputed for the new total. A split with
 * per-person amounts (exact, percent, adjustment) is kept as the amounts it had, which is
 * only right while the total stays put; otherwise the agent has to say who owes what.
 */
export function carryOverSplit(
  stored: readonly StoredSplit[],
  amountChanged: boolean,
): Carried<McpSplit> {
  if (stored.length > 0 && stored.every((s) => s.shareType === "equal")) {
    return { ok: true, value: { type: "equal", userIds: stored.map((s) => s.memberId) } };
  }
  if (stored.length > 0 && stored.every((s) => s.shareType === "shares" && s.weight != null)) {
    return {
      ok: true,
      value: {
        type: "shares",
        shares: stored.map((s) => ({ userId: s.memberId, weight: s.weight as number })),
      },
    };
  }
  if (!amountChanged) {
    return {
      ok: true,
      value: {
        type: "exact",
        amounts: stored.map((s) => ({ userId: s.memberId, amount: s.amount })),
      },
    };
  }
  return {
    ok: false,
    message:
      "The amount changed on a record whose split has per-person amounts. Send split with who owes what (equal, shares or exact).",
  };
}

/** `updatedAt` strings round-trip through a JS Date, so compare within a millisecond or so. */
export function sameInstantIso(a: string, b: string): boolean {
  const x = Date.parse(a);
  const y = Date.parse(b);
  return Number.isFinite(x) && Number.isFinite(y) && Math.abs(x - y) < 2;
}
