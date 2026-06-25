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
