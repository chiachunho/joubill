import { expect, test } from "./fixtures";
import { addExpense, addSettlement } from "./helpers";

/**
 * 備註 on a record: saved from the form, shown again when the record is reopened, marked in the
 * group list and logged as a change. Through the API, a body without `note` must keep the stored
 * one (older clients and other edit paths don't send it), and null clears it.
 */
test.describe("Record 備註", () => {
  test("a note typed in the expense form is saved, marked in the list and shown again", async ({
    authedPage,
    seeded,
    dbPool,
  }) => {
    const note = `E2E note ${Date.now()}`;
    const form = `/app/groups/${seeded.groupId}/expenses/${seeded.expenseId}/edit`;
    await authedPage.goto(form);
    // Folded behind the link in the 說明 / 日期 row until a record has one.
    await authedPage.getByRole("button", { name: "＋ 備註" }).click();
    await authedPage.getByLabel("備註", { exact: true }).fill(`  ${note}  `);
    await authedPage.getByRole("button", { name: "儲存", exact: true }).click();
    await expect(authedPage).toHaveURL(new RegExp(`/app/groups/${seeded.groupId}$`));

    const row = authedPage.locator(
      `a[href="/app/groups/${seeded.groupId}/expenses/${seeded.expenseId}/edit"]`,
    );
    await expect(row.getByRole("img", { name: "有備註" })).toBeVisible();

    const stored = await dbPool.query("SELECT note FROM expenses WHERE id=$1", [seeded.expenseId]);
    expect(stored.rows[0].note).toBe(note);

    const audit = await dbPool.query(
      `SELECT "before"->>'note' AS b, "after"->>'note' AS a FROM record_audit_log
        WHERE record_id=$1 AND action='updated' ORDER BY id DESC LIMIT 1`,
      [seeded.expenseId],
    );
    expect(audit.rows[0]).toEqual({ b: null, a: note });

    await authedPage.goto(form);
    await expect(authedPage.getByLabel("備註", { exact: true })).toHaveValue(note);
  });

  test("an edit that leaves out note keeps it, and null clears it", async ({
    authedPage,
    seeded,
    dbPool,
  }) => {
    const { request } = authedPage;
    const id = await addExpense(request, seeded.groupId, {
      amount: 100,
      shareType: "equal",
      payers: [{ payerId: seeded.userId, amount: 100 }],
      splits: [
        { debtorId: seeded.userId, amount: 50 },
        { debtorId: seeded.partnerId, amount: 50 },
      ],
      note: "keep me",
    });
    const url = `/api/groups/${seeded.groupId}/expenses/${id}`;
    const read = async () =>
      ((await (await request.get(url)).json()) as { note: string | null }).note;
    expect(await read()).toBe("keep me");

    const base = {
      amount: 120,
      currency: "TWD",
      description: "E2E note keep",
      spentAt: "2026-01-02",
      shareType: "equal",
      payers: [{ payerId: seeded.userId, amount: 120 }],
      splits: [
        { debtorId: seeded.userId, amount: 60 },
        { debtorId: seeded.partnerId, amount: 60 },
      ],
    };
    expect((await request.patch(url, { data: base })).ok()).toBe(true);
    expect(await read()).toBe("keep me");

    expect((await request.patch(url, { data: { ...base, note: null } })).ok()).toBe(true);
    const stored = await dbPool.query("SELECT note FROM expenses WHERE id=$1", [id]);
    expect(stored.rows[0].note).toBeNull();
  });

  test("a settlement keeps its note through the form", async ({ authedPage, seeded, dbPool }) => {
    const id = await addSettlement(
      authedPage.request,
      seeded.groupId,
      seeded.partnerId,
      seeded.userId,
      40,
    );
    const note = `E2E 末五碼 ${Date.now()}`;
    const form = `/app/groups/${seeded.groupId}/settlements/${id}`;
    await authedPage.goto(form);
    // Folded behind the link in the 說明 / 日期 row until a record has one.
    await authedPage.getByRole("button", { name: "＋ 備註" }).click();
    await authedPage.getByLabel("備註", { exact: true }).fill(note);
    await authedPage.getByRole("button", { name: "儲存", exact: true }).click();
    await expect(authedPage).toHaveURL(new RegExp(`/app/groups/${seeded.groupId}$`));

    const stored = await dbPool.query("SELECT note FROM expenses WHERE id=$1", [id]);
    expect(stored.rows[0].note).toBe(note);
    await authedPage.goto(form);
    await expect(authedPage.getByLabel("備註", { exact: true })).toHaveValue(note);
  });
});
