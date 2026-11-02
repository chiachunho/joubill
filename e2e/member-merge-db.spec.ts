import { expect, test } from "./fixtures";
import {
  addExpense,
  balances,
  editExpense,
  legs,
  legsNaming,
  mergedBalances,
  mkPlaceholder,
} from "./helpers";

/**
 * `mergeUserInto` against the real database (issue #107). The planner is unit-tested in
 * `member-merge.test.ts`; these cases cover what only Postgres can: the bulk
 * `UPDATE … FROM (VALUES …)` statements, `UNIQUE(expense_id, payer_id)`, the delete of the
 * placeholder's `users` row (which fails if any leg still names it) and the row locks.
 * Everything is driven through the API so the records look exactly like ones the app made.
 */
test.describe("Merging a member without an account (database)", () => {
  test("payers and splits of every kind combine and no balance moves", async ({
    authedPage,
    seeded,
    dbPool,
  }) => {
    const { request } = authedPage;
    const g = seeded.groupId;
    const me = seeded.userId;
    const partner = seeded.partnerId;
    const ghost = await mkPlaceholder(request, g, `E2E ghost ${Date.now()}`);

    // Both the viewer and the placeholder paid: their payer rows must become one.
    const bothPaid = await addExpense(request, g, {
      amount: 300,
      shareType: "exact",
      payers: [
        { payerId: me, amount: 100 },
        { payerId: ghost, amount: 200 },
      ],
      splits: [
        { debtorId: me, amount: 150 },
        { debtorId: partner, amount: 150 },
      ],
    });
    // One expense per split kind, each with the viewer, the placeholder and the partner.
    const paidByPartner = [{ payerId: partner, amount: 300 }];
    const equal = await addExpense(request, g, {
      amount: 300,
      shareType: "equal",
      payers: paidByPartner,
      splits: [
        { debtorId: me, amount: 100 },
        { debtorId: ghost, amount: 100 },
        { debtorId: partner, amount: 100 },
      ],
    });
    const shares = await addExpense(request, g, {
      amount: 300,
      shareType: "shares",
      payers: paidByPartner,
      splits: [
        { debtorId: me, amount: 75, splitValue: 1 },
        { debtorId: ghost, amount: 150, splitValue: 2 },
        { debtorId: partner, amount: 75, splitValue: 1 },
      ],
    });
    const percent = await addExpense(request, g, {
      amount: 300,
      shareType: "percent",
      payers: paidByPartner,
      splits: [
        { debtorId: me, amount: 150, splitValue: 50 },
        { debtorId: ghost, amount: 90, splitValue: 30 },
        { debtorId: partner, amount: 60, splitValue: 20 },
      ],
    });
    const exact = await addExpense(request, g, {
      amount: 300,
      shareType: "exact",
      payers: paidByPartner,
      splits: [
        { debtorId: me, amount: 100 },
        { debtorId: ghost, amount: 120 },
        { debtorId: partner, amount: 80 },
      ],
    });
    const adjustment = await addExpense(request, g, {
      amount: 300,
      shareType: "adjustment",
      payers: paidByPartner,
      splits: [
        { debtorId: me, amount: 120, splitValue: 30 },
        { debtorId: ghost, amount: 90, splitValue: 0 },
        { debtorId: partner, amount: 90, splitValue: 0 },
      ],
    });

    const before = await balances(request, g);
    const res = await request.post(`/api/groups/${g}/members/${ghost}/merge`, {
      data: { intoUserId: me },
    });
    expect(res.status(), await res.text()).toBe(200);

    expect(await balances(request, g)).toEqual(mergedBalances(before, ghost, me));
    const all = [bothPaid, equal, shares, percent, exact, adjustment];
    expect(await legsNaming(dbPool, all, ghost)).toBe(false);

    // `legs` orders rows by user id; the viewer was created before the partner.
    const split = (
      debtorId: number,
      amount: number,
      shareType: string,
      splitValue: number | null,
    ) => ({ debtorId, amount, shareType, splitValue });

    expect((await legs(dbPool, bothPaid)).payers).toEqual([{ payerId: me, amount: 300 }]);

    // Two equal parts are a weight of 2, and the rest of the expense follows to `shares`.
    expect((await legs(dbPool, equal)).splits).toEqual([
      split(me, 200, "shares", 2),
      split(partner, 100, "shares", 1),
    ]);
    expect((await legs(dbPool, shares)).splits).toEqual([
      split(me, 225, "shares", 3),
      split(partner, 75, "shares", 1),
    ]);
    expect((await legs(dbPool, percent)).splits).toEqual([
      split(me, 240, "percent", 80),
      split(partner, 60, "percent", 20),
    ]);
    expect((await legs(dbPool, exact)).splits).toEqual([
      split(me, 220, "exact", null),
      split(partner, 80, "exact", null),
    ]);
    // An adjustment is relative to an equal split that just shrank, so the whole expense
    // flattens to the exact amounts.
    expect((await legs(dbPool, adjustment)).splits).toEqual([
      split(me, 210, "exact", null),
      split(partner, 90, "exact", null),
    ]);
  });

  test("an edit to the same expense at the same moment doesn't break the merge", async ({
    authedPage,
    seeded,
    dbPool,
  }) => {
    const { request } = authedPage;
    const g = seeded.groupId;
    const me = seeded.userId;
    const partner = seeded.partnerId;

    // The edit replaces every payer and split row, and drops the placeholder. Whichever commits
    // first, the merge must neither trip over row ids the edit deleted nor leave a leg naming
    // the placeholder (deleting its `users` row would fail if it did). The interleaving can't
    // be forced from outside, so a few rounds give both orders a chance.
    for (let round = 0; round < 5; round++) {
      const ghost = await mkPlaceholder(request, g, `E2E race ${round} ${Date.now()}`);
      const expenseId = await addExpense(request, g, {
        amount: 300,
        shareType: "equal",
        payers: [{ payerId: me, amount: 300 }],
        splits: [
          { debtorId: me, amount: 100 },
          { debtorId: ghost, amount: 100 },
          { debtorId: partner, amount: 100 },
        ],
      });

      const [edit, merge] = await Promise.all([
        editExpense(request, g, expenseId, {
          amount: 300,
          shareType: "equal",
          payers: [{ payerId: me, amount: 300 }],
          splits: [
            { debtorId: me, amount: 150 },
            { debtorId: partner, amount: 150 },
          ],
        }),
        request.post(`/api/groups/${g}/members/${ghost}/merge`, { data: { intoUserId: me } }),
      ]);
      expect(edit.status(), await edit.text()).toBe(200);
      expect(merge.status(), await merge.text()).toBe(200);

      const after = await legs(dbPool, expenseId);
      expect(await legsNaming(dbPool, [expenseId], ghost)).toBe(false);
      expect(after.payers.reduce((s, p) => s + p.amount, 0)).toBeCloseTo(300, 2);
      expect(after.splits.reduce((s, x) => s + x.amount, 0)).toBeCloseTo(300, 2);
    }
  });
});
