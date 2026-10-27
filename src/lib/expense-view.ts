/**
 * Per-expense, per-user amount helpers for the expense-list "view by balance"
 * mode and the "only mine" filter.
 *
 * Amounts are returned in the expense's own currency (no FX conversion) to stay
 * consistent with the list's total view; the group-level Balance section is the
 * place that normalises to the group default currency.
 */

export type ExpenseViewMode = "total" | "balance";

/** localStorage keys for the expense-list view preferences (shared by the Mini App and Web App pages). */
export const EXPENSE_VIEW_MODE_KEY = "splitbill:expenseView";
export const EXPENSE_ONLY_MINE_KEY = "splitbill:expenseOnlyMine";

export type ExpenseLike = {
  payers: { userId: number; amount: number }[];
  splits: { debtorId: number; amount: number }[];
};

export type ExpenseUserBalance = {
  /** Total this user paid on the expense. */
  paid: number;
  /** Total this user owes (their split). */
  owed: number;
  /** Net impact on this user: paid − owed (positive = others owe them). */
  net: number;
};

export function expenseUserBalance(e: ExpenseLike, userId: number | undefined): ExpenseUserBalance {
  if (userId === undefined) return { paid: 0, owed: 0, net: 0 };
  const paid = e.payers.filter((p) => p.userId === userId).reduce((s, p) => s + p.amount, 0);
  const owed = e.splits.filter((s) => s.debtorId === userId).reduce((s, x) => s + x.amount, 0);
  return { paid, owed, net: paid - owed };
}

/** Whether the user is involved in the expense as a payer or a debtor. */
export function isRelatedToUser(e: ExpenseLike, userId: number | undefined): boolean {
  if (userId === undefined) return true;
  const { paid, owed } = expenseUserBalance(e, userId);
  return paid !== 0 || owed !== 0;
}

/**
 * Whether a record from the expenses list is a repayment (stored as a
 * `type='settlement'` expense: sole payer = sender, sole debtor = receiver).
 * Used by the merged list to render settlement rows differently and link them
 * to the settlement form instead of the expense form.
 */
export function isSettlement(e: { type?: string }): boolean {
  return e.type === "settlement";
}

/** A from/to party for a settlement row, shaped for `labelUser` / `Avatar`. */
export type SettlementParty = {
  userId: number;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
};

/**
 * Derive a settlement's sender/receiver from its sole payer/split. Centralises
 * the `split.debtorId → userId` remap so the two group-list pages stay in sync.
 */
export function settlementParties(e: {
  payers: {
    userId: number;
    firstName: string | null;
    lastName: string | null;
    username: string | null;
  }[];
  splits: {
    debtorId: number;
    firstName: string | null;
    lastName: string | null;
    username: string | null;
  }[];
}): { from: SettlementParty | null; to: SettlementParty | null } {
  const p = e.payers[0];
  const s = e.splits[0];
  return {
    from: p
      ? { userId: p.userId, firstName: p.firstName, lastName: p.lastName, username: p.username }
      : null,
    to: s
      ? { userId: s.debtorId, firstName: s.firstName, lastName: s.lastName, username: s.username }
      : null,
  };
}
