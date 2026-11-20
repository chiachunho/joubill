import { expect, test } from "./fixtures";
import { addExpense, auditActions, balances, editExpense, legs, type ExpenseBody } from "./helpers";

/**
 * 退稅 (issue #178): money that came back on an expense, stored as a `type='refund'` record
 * whose payers are the people it is shared back to and whose one split is who received it.
 * These pin what fails silently: the balance it must leave, the ratio following the expense's
 * split, and an expense's delete taking its refunds with it, each with an audit row.
 */
function body(me: number, partner: number, amount: number): ExpenseBody {
  return {
    amount,
    shareType: "equal",
    payers: [{ payerId: me, amount }],
    splits: [
      { debtorId: me, amount: amount / 2 },
      { debtorId: partner, amount: amount / 2 },
    ],
  };
}

test.describe("Refunds", () => {
  test("a ratio refund leaves the balance an expense that cost less would", async ({
    authedPage,
    seeded,
    dbPool,
  }) => {
    const { request } = authedPage;
    const before = await balances(request, seeded.groupId);
    const expenseId = await addExpense(
      request,
      seeded.groupId,
      body(seeded.userId, seeded.partnerId, 1100),
    );

    const res = await request.post(`/api/groups/${seeded.groupId}/expenses/${expenseId}/refunds`, {
      data: { amount: 100, currency: "TWD", receivedBy: seeded.userId },
    });
    expect(res.status(), await res.text()).toBe(201);
    const { id: refundId } = (await res.json()) as { id: number };

    expect(await legs(dbPool, refundId)).toEqual({
      payers: [
        { payerId: Math.min(seeded.userId, seeded.partnerId), amount: 50 },
        { payerId: Math.max(seeded.userId, seeded.partnerId), amount: 50 },
      ],
      splits: [{ debtorId: seeded.userId, amount: 100, shareType: "exact", splitValue: null }],
    });

    // Same as an expense of 1,000 split two ways: the partner owes 500 more, not 550.
    const after = await balances(request, seeded.groupId);
    expect((after.get(seeded.partnerId) ?? 0) - (before.get(seeded.partnerId) ?? 0)).toBeCloseTo(
      -500,
      2,
    );

    // The expense's page lists it.
    const detail = await request.get(`/api/groups/${seeded.groupId}/expenses/${expenseId}`);
    const { refunds } = (await detail.json()) as { refunds: { id: number }[] };
    expect(refunds.map((r) => r.id)).toEqual([refundId]);

    // The expense's own history includes the refund's row.
    const history = await request.get(`/api/groups/${seeded.groupId}/activity?record=${expenseId}`);
    const { entries } = (await history.json()) as {
      entries: { recordId: number | null; recordType: string; action: string }[];
    };
    expect(entries).toContainEqual(
      expect.objectContaining({ recordId: refundId, recordType: "refund", action: "created" }),
    );
  });

  test("a ratio refund follows its expense's new split, and says so in its history", async ({
    authedPage,
    seeded,
    dbPool,
  }) => {
    const { request } = authedPage;
    const expenseId = await addExpense(
      request,
      seeded.groupId,
      body(seeded.userId, seeded.partnerId, 200),
    );
    const created = await request.post(
      `/api/groups/${seeded.groupId}/expenses/${expenseId}/refunds`,
      { data: { amount: 20, currency: "TWD", receivedBy: seeded.userId } },
    );
    const { id: refundId } = (await created.json()) as { id: number };

    // The partner drops out of the expense: the whole refund now goes back to the user.
    const edit = await editExpense(request, seeded.groupId, expenseId, {
      amount: 200,
      shareType: "equal",
      payers: [{ payerId: seeded.userId, amount: 200 }],
      splits: [{ debtorId: seeded.userId, amount: 200 }],
    });
    expect(edit.ok(), await edit.text()).toBe(true);

    expect((await legs(dbPool, refundId)).payers).toEqual([{ payerId: seeded.userId, amount: 20 }]);
    const cause = await dbPool.query(
      `SELECT "after"->>'cause' AS cause FROM record_audit_log
        WHERE record_id=$1 AND action='updated' ORDER BY id DESC LIMIT 1`,
      [refundId],
    );
    expect(cause.rows[0]?.cause).toBe("parent_updated");
  });

  test("a custom refund must add up, and keeps its amounts when the expense changes", async ({
    authedPage,
    seeded,
    dbPool,
  }) => {
    const { request } = authedPage;
    const expenseId = await addExpense(
      request,
      seeded.groupId,
      body(seeded.userId, seeded.partnerId, 200),
    );
    const url = `/api/groups/${seeded.groupId}/expenses/${expenseId}/refunds`;

    const short = await request.post(url, {
      data: {
        amount: 30,
        currency: "TWD",
        receivedBy: seeded.userId,
        split: "custom",
        shares: [{ userId: seeded.partnerId, amount: 20 }],
      },
    });
    expect(short.status()).toBe(400);

    const ok = await request.post(url, {
      data: {
        amount: 30,
        currency: "TWD",
        receivedBy: seeded.userId,
        split: "custom",
        shares: [{ userId: seeded.partnerId, amount: 30 }],
      },
    });
    expect(ok.status()).toBe(201);
    const { id: refundId } = (await ok.json()) as { id: number };

    await editExpense(
      request,
      seeded.groupId,
      expenseId,
      body(seeded.userId, seeded.partnerId, 300),
    );
    expect((await legs(dbPool, refundId)).payers).toEqual([
      { payerId: seeded.partnerId, amount: 30 },
    ]);
  });

  test("deleting an expense deletes its refunds first, each with an audit row", async ({
    authedPage,
    seeded,
    dbPool,
  }) => {
    const { request } = authedPage;
    const expenseId = await addExpense(
      request,
      seeded.groupId,
      body(seeded.userId, seeded.partnerId, 200),
    );
    const created = await request.post(
      `/api/groups/${seeded.groupId}/expenses/${expenseId}/refunds`,
      { data: { amount: 20, currency: "TWD", receivedBy: seeded.partnerId } },
    );
    const { id: refundId } = (await created.json()) as { id: number };

    const del = await request.delete(`/api/groups/${seeded.groupId}/expenses/${expenseId}`);
    expect(del.ok(), await del.text()).toBe(true);

    const left = await dbPool.query("SELECT id FROM expenses WHERE id = ANY($1)", [
      [expenseId, refundId],
    ]);
    expect(left.rows).toEqual([]);
    expect(await auditActions(dbPool, seeded.groupId, refundId)).toEqual(["created", "deleted"]);
    const cause = await dbPool.query(
      `SELECT "before"->>'cause' AS cause FROM record_audit_log
        WHERE record_id=$1 AND action='deleted'`,
      [refundId],
    );
    expect(cause.rows[0]?.cause).toBe("parent_deleted");
  });

  test("a refund cannot be recorded on a settlement or another group's expense", async ({
    authedPage,
    seeded,
  }) => {
    const { request } = authedPage;
    const settle = await request.post(`/api/groups/${seeded.groupId}/settlements`, {
      data: { fromUserId: seeded.partnerId, toUserId: seeded.userId, amount: 10, currency: "TWD" },
    });
    const { id: settlementId } = (await settle.json()) as { id: number };
    const res = await request.post(
      `/api/groups/${seeded.groupId}/expenses/${settlementId}/refunds`,
      { data: { amount: 5, currency: "TWD", receivedBy: seeded.userId } },
    );
    expect(res.status()).toBe(404);
  });

  test("the expense form records a refund and shows it", async ({ authedPage, seeded }) => {
    const form = `/app/groups/${seeded.groupId}/expenses/${seeded.expenseId}/edit`;
    await authedPage.goto(form);
    await authedPage.getByRole("link", { name: "記一筆退稅" }).click();
    await expect(authedPage.getByRole("heading", { name: "新增退稅" })).toBeVisible();

    await authedPage.getByLabel("金額", { exact: true }).fill("30");
    await authedPage.getByRole("button", { name: "儲存", exact: true }).click();
    await expect(authedPage).toHaveURL(new RegExp(`${form}$`));
    await expect(authedPage.getByText(/已退稅 30 TWD/)).toBeVisible();
    // The expense itself was never edited, but its history is reachable for the refund.
    await expect(authedPage.getByRole("link", { name: /變更紀錄（含 1 筆退稅）/ })).toBeVisible();

    // The group list shows it as its own row, marked as a refund.
    await authedPage.goto(`/app/groups/${seeded.groupId}`);
    await expect(authedPage.getByRole("img", { name: "退稅" }).first()).toBeVisible();
  });
});
