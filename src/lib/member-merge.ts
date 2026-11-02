/**
 * Merging a placeholder member into a real account.
 *
 * Pure — no DB — so the part that can go quietly wrong (two people appearing on
 * the same expense) is unit-tested. The transaction that applies a plan lives in
 * `src/lib/member-merge-db.ts`.
 *
 * Whatever is combined, each row's `amount` is summed exactly, so the group's
 * balances never move; only `share_type` / `split_value` need care.
 */

export type MergePayerRow = { id: number; expenseId: number; payerId: number; amount: number };
export type MergeSplitRow = {
  id: number;
  expenseId: number;
  debtorId: number;
  amount: number;
  shareType: string;
  splitValue: number | null;
};
export type MergeExpenseMeta = { id: number; type: string; currency: string };

export type MergeUser = { id: number; placeholderGroupId: number | null };

export type MergeCheck = { ok: true } | { ok: false; status: 400 | 403 | 404; error: string };

/** `from` must be this group's placeholder and `to` a real account. */
export function validateMerge(
  groupId: number,
  from: MergeUser | undefined,
  to: MergeUser | undefined,
): MergeCheck {
  if (!from || !to) return { ok: false, status: 404, error: "member not found" };
  if (from.id === to.id)
    return { ok: false, status: 400, error: "cannot merge a member into itself" };
  if (from.placeholderGroupId !== groupId) {
    return { ok: false, status: 403, error: "only this group's placeholder members can be merged" };
  }
  if (to.placeholderGroupId !== null) {
    return { ok: false, status: 400, error: "target must be a real account" };
  }
  return { ok: true };
}

const round2 = (v: number) => Math.round(v * 100) / 100;
const round6 = (v: number) => Math.round(v * 1_000_000) / 1_000_000;

export type SplitUpdate = {
  id: number;
  debtorId?: number;
  amount?: number;
  shareType?: string;
  splitValue?: number | null;
};

export type MergePlan = {
  /** `expense_payers` rows to repoint at `to`. */
  payerRepoint: number[];
  /** Both paid: add `amount` onto `keepId` (to's row), delete `deleteId` (from's row). */
  payerMerge: { keepId: number; deleteId: number; amount: number }[];
  /** `expense_splits` changes: repoints, merged totals and equal→shares weight conversions. */
  splitUpdates: SplitUpdate[];
  splitDelete: number[];
  /** Every expense or settlement that gets rewritten. */
  recordIds: number[];
};

/**
 * Settlements between the two merging people. Once they are one person these read "A → A":
 * balances are unaffected, but the record means nothing and the settlement form refuses to
 * save it, so the merger chooses between deleting them and keeping them (then delete-only).
 */
export function findSelfSettlements(input: {
  fromId: number;
  toId: number;
  expenses: MergeExpenseMeta[];
  payers: MergePayerRow[];
  splits: MergeSplitRow[];
}): number[] {
  const pair = new Set([input.fromId, input.toId]);
  return input.expenses
    .filter((e) => e.type === "settlement")
    .filter((e) => {
      const payers = input.payers.filter((p) => p.expenseId === e.id);
      const debtors = input.splits.filter((s) => s.expenseId === e.id);
      return (
        payers.length === 1 &&
        debtors.length === 1 &&
        pair.has(payers[0].payerId) &&
        pair.has(debtors[0].debtorId) &&
        payers[0].payerId !== debtors[0].debtorId
      );
    })
    .map((e) => e.id)
    .sort((a, b) => a - b);
}

/** How two split rows for the same person on one expense combine. */
export function combineSplit(
  a: MergeSplitRow,
  b: MergeSplitRow,
): { shareType: string; splitValue: number | null } {
  if (a.shareType === b.shareType) {
    switch (a.shareType) {
      case "shares":
      case "percent":
        return {
          shareType: a.shareType,
          splitValue: round6((a.splitValue ?? 0) + (b.splitValue ?? 0)),
        };
      case "equal":
        // Two equal parts is a weight of 2; the caller converts the rest to weight 1.
        return { shareType: "shares", splitValue: 2 };
      case "exact":
        return { shareType: "exact", splitValue: null };
    }
  }
  // Mixed kinds (or adjustment) have no honest weight; the summed amount is the truth.
  return { shareType: "exact", splitValue: null };
}

export function planMerge(input: {
  fromId: number;
  toId: number;
  payers: MergePayerRow[];
  /** Every split of every expense the placeholder appears in. */
  splits: MergeSplitRow[];
}): MergePlan {
  const { fromId, toId } = input;
  const touched = new Set<number>();

  const payerRepoint: number[] = [];
  const payerMerge: MergePlan["payerMerge"] = [];
  const payersByExpense = new Map<number, MergePayerRow[]>();
  for (const p of input.payers) {
    payersByExpense.set(p.expenseId, [...(payersByExpense.get(p.expenseId) ?? []), p]);
  }
  for (const [expenseId, rows] of payersByExpense) {
    const from = rows.find((r) => r.payerId === fromId);
    if (!from) continue;
    touched.add(expenseId);
    const to = rows.find((r) => r.payerId === toId);
    if (to) {
      payerMerge.push({
        keepId: to.id,
        deleteId: from.id,
        amount: round2(to.amount + from.amount),
      });
    } else {
      payerRepoint.push(from.id);
    }
  }

  const splitUpdates: SplitUpdate[] = [];
  const splitDelete: number[] = [];
  const splitsByExpense = new Map<number, MergeSplitRow[]>();
  for (const s of input.splits) {
    splitsByExpense.set(s.expenseId, [...(splitsByExpense.get(s.expenseId) ?? []), s]);
  }
  for (const [expenseId, rows] of splitsByExpense) {
    const from = rows.find((r) => r.debtorId === fromId);
    if (!from) continue;
    touched.add(expenseId);
    const to = rows.find((r) => r.debtorId === toId);
    if (!to) {
      splitUpdates.push({ id: from.id, debtorId: toId });
      continue;
    }
    const combined = combineSplit(to, from);
    splitUpdates.push({
      id: to.id,
      amount: round2(to.amount + from.amount),
      shareType: combined.shareType,
      splitValue: combined.splitValue,
    });
    splitDelete.push(from.id);
    // The edit form reads `share_type` from the first row and treats the expense as uniform,
    // so a changed kind has to reach every row or the form recomputes amounts on save.
    for (const other of rows) {
      if (other.id === to.id || other.id === from.id) continue;
      if (combined.shareType === "shares" && other.shareType === "equal") {
        splitUpdates.push({ id: other.id, shareType: "shares", splitValue: 1 });
      } else if (combined.shareType === "exact" && other.shareType !== "exact") {
        splitUpdates.push({ id: other.id, shareType: "exact", splitValue: null });
      }
    }
  }

  return {
    payerRepoint,
    payerMerge,
    splitUpdates,
    splitDelete,
    recordIds: [...touched].sort((a, b) => a - b),
  };
}

/** What to do with settlements between the two people: `keep` leaves them (delete-only later). */
export type SelfSettlementChoice = "delete" | "keep";

export type MergeSummary = {
  expenses: number;
  settlements: number;
  /** How many of `settlements` are between the two people and would read "A → A". */
  selfSettlements: number;
  /** The placeholder's net position per record currency (paid − owed), 2 dp. */
  net: Record<string, number>;
};

/** What a confirm dialog shows before anything is written. */
export function summariseMerge(input: {
  fromId: number;
  toId: number;
  payers: MergePayerRow[];
  splits: MergeSplitRow[];
  expenses: MergeExpenseMeta[];
}): MergeSummary {
  const meta = new Map(input.expenses.map((e) => [e.id, e]));
  const ids = new Set<number>();
  const net: Record<string, number> = {};
  const add = (expenseId: number, delta: number) => {
    const m = meta.get(expenseId);
    if (!m) return;
    ids.add(expenseId);
    net[m.currency] = round2((net[m.currency] ?? 0) + delta);
  };
  for (const p of input.payers) if (p.payerId === input.fromId) add(p.expenseId, p.amount);
  for (const s of input.splits) if (s.debtorId === input.fromId) add(s.expenseId, -s.amount);

  let settlements = 0;
  for (const id of ids) if (meta.get(id)?.type === "settlement") settlements += 1;
  const selfSettlements = findSelfSettlements(input).length;
  return { expenses: ids.size - settlements, settlements, selfSettlements, net };
}
