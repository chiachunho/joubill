import { describe, expect, it } from "vitest";

import { expenseUserBalance, isRelatedToUser, type ExpenseLike } from "../expense-view";

// Alice (1) paid 300; split equally three ways (1, 2, 3) at 100 each.
const expense: ExpenseLike = {
  payers: [{ userId: 1, amount: 300 }],
  splits: [
    { debtorId: 1, amount: 100 },
    { debtorId: 2, amount: 100 },
    { debtorId: 3, amount: 100 },
  ],
};

describe("expenseUserBalance", () => {
  it("nets paid minus owed for someone who both paid and owes", () => {
    expect(expenseUserBalance(expense, 1)).toEqual({ paid: 300, owed: 100, net: 200 });
  });

  it("is negative for a debtor who did not pay", () => {
    expect(expenseUserBalance(expense, 2)).toEqual({ paid: 0, owed: 100, net: -100 });
  });

  it("sums multiple payer/split rows for the same user", () => {
    const e: ExpenseLike = {
      payers: [
        { userId: 1, amount: 50 },
        { userId: 1, amount: 30 },
      ],
      splits: [
        { debtorId: 1, amount: 20 },
        { debtorId: 1, amount: 10 },
      ],
    };
    expect(expenseUserBalance(e, 1)).toEqual({ paid: 80, owed: 30, net: 50 });
  });

  it("returns zeros for an uninvolved user", () => {
    expect(expenseUserBalance(expense, 99)).toEqual({ paid: 0, owed: 0, net: 0 });
  });

  it("returns zeros when userId is undefined", () => {
    expect(expenseUserBalance(expense, undefined)).toEqual({ paid: 0, owed: 0, net: 0 });
  });
});

describe("isRelatedToUser", () => {
  it("is true for a payer", () => {
    expect(isRelatedToUser(expense, 1)).toBe(true);
  });

  it("is true for a debtor who did not pay", () => {
    expect(isRelatedToUser(expense, 2)).toBe(true);
  });

  it("is false for an uninvolved user", () => {
    expect(isRelatedToUser(expense, 99)).toBe(false);
  });

  it("is true (no filtering) when userId is undefined", () => {
    expect(isRelatedToUser(expense, undefined)).toBe(true);
  });
});
