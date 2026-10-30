import { describe, expect, it } from "vitest";

import {
  combineSplit,
  planMerge,
  rekeyPersonAccounts,
  summariseMerge,
  validateMerge,
  type MergeSplitRow,
} from "../member-merge";

const FROM = 10;
const TO = 20;
const OTHER = 30;

let nextId = 1;
const split = (
  expenseId: number,
  debtorId: number,
  amount: number,
  shareType = "equal",
  splitValue: number | null = null,
): MergeSplitRow => ({ id: nextId++, expenseId, debtorId, amount, shareType, splitValue });
const payer = (expenseId: number, payerId: number, amount: number) => ({
  id: nextId++,
  expenseId,
  payerId,
  amount,
});

describe("validateMerge", () => {
  const placeholder = { id: FROM, placeholderGroupId: 1 };
  const real = { id: TO, placeholderGroupId: null };

  it("accepts a group placeholder merged into a real account", () => {
    expect(validateMerge(1, placeholder, real)).toEqual({ ok: true });
  });
  it("refuses a placeholder from another group", () => {
    expect(validateMerge(2, placeholder, real)).toMatchObject({ ok: false, status: 403 });
  });
  it("refuses a real account as the source", () => {
    expect(validateMerge(1, real, placeholder)).toMatchObject({ ok: false, status: 403 });
  });
  it("refuses a placeholder as the target", () => {
    expect(validateMerge(1, placeholder, { id: 99, placeholderGroupId: 1 })).toMatchObject({
      ok: false,
      status: 400,
    });
  });
  it("refuses merging into itself and missing users", () => {
    expect(validateMerge(1, placeholder, placeholder)).toMatchObject({ ok: false, status: 400 });
    expect(validateMerge(1, undefined, real)).toMatchObject({ ok: false, status: 404 });
  });
});

describe("planMerge payers", () => {
  it("repoints a payer row when only the placeholder paid", () => {
    const p = payer(1, FROM, 100);
    const plan = planMerge({
      fromId: FROM,
      toId: TO,
      payers: [p, payer(1, OTHER, 50)],
      splits: [],
    });
    expect(plan.payerRepoint).toEqual([p.id]);
    expect(plan.payerMerge).toEqual([]);
    expect(plan.recordIds).toEqual([1]);
  });

  it("sums into the target row when both paid (UNIQUE(expense_id, payer_id))", () => {
    const a = payer(1, FROM, 30.1);
    const b = payer(1, TO, 70.2);
    const plan = planMerge({ fromId: FROM, toId: TO, payers: [a, b], splits: [] });
    expect(plan.payerRepoint).toEqual([]);
    expect(plan.payerMerge).toEqual([{ keepId: b.id, deleteId: a.id, amount: 100.3 }]);
  });

  it("ignores expenses the placeholder did not pay", () => {
    const plan = planMerge({ fromId: FROM, toId: TO, payers: [payer(1, TO, 5)], splits: [] });
    expect(plan.payerRepoint).toEqual([]);
    expect(plan.recordIds).toEqual([]);
  });
});

describe("planMerge splits", () => {
  it("repoints a split when only the placeholder owes", () => {
    const s = split(1, FROM, 50);
    const plan = planMerge({
      fromId: FROM,
      toId: TO,
      payers: [],
      splits: [s, split(1, OTHER, 50)],
    });
    expect(plan.splitUpdates).toEqual([{ id: s.id, debtorId: TO }]);
    expect(plan.splitDelete).toEqual([]);
  });

  it("collapses two equal rows into a weight-2 share and weights the rest at 1", () => {
    const f = split(1, FROM, 25);
    const t = split(1, TO, 25);
    const o = split(1, OTHER, 25);
    const plan = planMerge({ fromId: FROM, toId: TO, payers: [], splits: [f, t, o] });
    expect(plan.splitDelete).toEqual([f.id]);
    expect(plan.splitUpdates).toContainEqual({
      id: t.id,
      amount: 50,
      shareType: "shares",
      splitValue: 2,
    });
    expect(plan.splitUpdates).toContainEqual({ id: o.id, shareType: "shares", splitValue: 1 });
  });

  it("adds share weights and percentages", () => {
    expect(combineSplit(split(1, TO, 1, "shares", 2), split(1, FROM, 1, "shares", 1))).toEqual({
      shareType: "shares",
      splitValue: 3,
    });
    expect(
      combineSplit(split(1, TO, 1, "percent", 20.5), split(1, FROM, 1, "percent", 10.25)),
    ).toEqual({ shareType: "percent", splitValue: 30.75 });
  });

  it("keeps exact rows exact", () => {
    expect(combineSplit(split(1, TO, 1, "exact"), split(1, FROM, 1, "exact"))).toEqual({
      shareType: "exact",
      splitValue: null,
    });
  });

  it("falls back to exact for mixed kinds, still summing the amount", () => {
    const f = split(1, FROM, 40, "exact");
    const t = split(1, TO, 60, "shares", 3);
    const plan = planMerge({ fromId: FROM, toId: TO, payers: [], splits: [f, t] });
    expect(plan.splitUpdates).toEqual([
      { id: t.id, amount: 100, shareType: "exact", splitValue: null },
    ]);
  });

  it("flattens the whole expense to exact when the merge can't keep its kind", () => {
    // Adjustment deltas are relative to an equal split among participants, which just shrank by one.
    const f = split(1, FROM, 30, "adjustment", 5);
    const t = split(1, TO, 40, "adjustment", -5);
    const o = split(1, OTHER, 30, "adjustment", 0);
    const plan = planMerge({ fromId: FROM, toId: TO, payers: [], splits: [f, t, o] });
    expect(plan.splitUpdates).toContainEqual({
      id: t.id,
      amount: 70,
      shareType: "exact",
      splitValue: null,
    });
    expect(plan.splitUpdates).toContainEqual({ id: o.id, shareType: "exact", splitValue: null });
  });

  it("does not change which expenses are rewritten across payers and splits", () => {
    const plan = planMerge({
      fromId: FROM,
      toId: TO,
      payers: [payer(3, FROM, 10)],
      splits: [split(1, FROM, 5), split(3, FROM, 10)],
    });
    expect(plan.recordIds).toEqual([1, 3]);
  });
});

describe("balance invariance", () => {
  it("the combined position equals the sum of both positions", () => {
    const payers = [payer(1, FROM, 90), payer(1, TO, 10)];
    const splits = [split(1, FROM, 25), split(1, TO, 25), split(1, OTHER, 50)];
    const plan = planMerge({ fromId: FROM, toId: TO, payers, splits });

    const mergedPaid = plan.payerMerge[0].amount;
    const mergedOwed = plan.splitUpdates.find((u) => u.amount !== undefined)!.amount!;
    expect(mergedPaid - mergedOwed).toBeCloseTo(90 + 10 - 25 - 25);
  });
});

describe("summariseMerge", () => {
  it("counts expenses and settlements and nets per currency", () => {
    const summary = summariseMerge({
      fromId: FROM,
      payers: [payer(1, FROM, 300), payer(2, OTHER, 80)],
      splits: [split(1, FROM, 100), split(2, FROM, 40), split(3, FROM, 60)],
      expenses: [
        { id: 1, type: "expense", currency: "TWD" },
        { id: 2, type: "expense", currency: "JPY" },
        { id: 3, type: "settlement", currency: "TWD" },
      ],
    });
    expect(summary).toEqual({ expenses: 2, settlements: 1, net: { TWD: 140, JPY: -40 } });
  });
});

describe("rekeyPersonAccounts", () => {
  it("moves the key to the new account", () => {
    expect(rekeyPersonAccounts({ "10": "Amy", "5": "Bob" }, 10, 20)).toEqual({
      "5": "Bob",
      "20": "Amy",
    });
  });
  it("lets the target's own entry win", () => {
    expect(rekeyPersonAccounts({ "10": "Old", "20": "Mine" }, 10, 20)).toEqual({ "20": "Mine" });
  });
  it("leaves a map without the placeholder untouched", () => {
    const map = { "5": "Bob" };
    expect(rekeyPersonAccounts(map, 10, 20)).toBe(map);
  });
});
