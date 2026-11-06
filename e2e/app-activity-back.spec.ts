import { expect, test } from "./fixtures";
import { addExpense, editExpense, type ExpenseBody } from "./helpers";

function body(seeded: { userId: number; partnerId: number }, amount: number): ExpenseBody {
  return {
    amount,
    shareType: "equal",
    payers: [{ payerId: seeded.userId, amount }],
    splits: [
      { debtorId: seeded.userId, amount: amount / 2 },
      { debtorId: seeded.partnerId, amount: amount / 2 },
    ],
  };
}

test.describe("Record history: 返回 goes back to where you came from", () => {
  test("from the edit form it returns to the form, from the feed to the feed", async ({
    authedPage,
    seeded,
  }) => {
    const g = seeded.groupId;
    // An edit gives the record a history and the form its 最後由 … 修改 link.
    const res = await editExpense(authedPage.request, g, seeded.expenseId, body(seeded, 320));
    expect(res.ok(), await res.text()).toBe(true);

    // From the form.
    const form = `/app/groups/${g}/expenses/${seeded.expenseId}/edit`;
    await authedPage.goto(form);
    await authedPage.getByRole("link", { name: /最後由 .* 修改/ }).click();
    await expect(authedPage.getByRole("heading", { name: "變更紀錄" })).toBeVisible();
    await authedPage.getByRole("link", { name: "返回" }).click();
    await expect(authedPage).toHaveURL(new RegExp(`${form}$`));

    // From the group feed.
    await authedPage.goto(`/app/groups/${g}/activity`);
    await authedPage
      .getByRole("link", { name: /改了|新增了/ })
      .first()
      .click();
    await expect(authedPage.getByRole("heading", { name: "變更紀錄" })).toBeVisible();
    await authedPage.getByRole("link", { name: "返回" }).click();
    await expect(authedPage).toHaveURL(new RegExp(`/app/groups/${g}/activity$`));
  });

  test("a from pointing elsewhere is ignored", async ({ authedPage, seeded }) => {
    const g = seeded.groupId;
    await authedPage.goto(
      `/app/groups/${g}/activity?record=${seeded.expenseId}&from=${encodeURIComponent("https://evil.test/")}`,
    );
    await expect(authedPage.getByRole("link", { name: "返回" })).toHaveAttribute(
      "href",
      `/app/groups/${g}`,
    );
  });

  test("a deleted record's row in the feed still opens its history", async ({
    authedPage,
    seeded,
  }) => {
    const g = seeded.groupId;
    const id = await addExpense(authedPage.request, g, body(seeded, 50));
    expect((await authedPage.request.delete(`/api/groups/${g}/expenses/${id}`)).ok()).toBe(true);

    await authedPage.goto(`/app/groups/${g}/activity`);
    await authedPage
      .getByRole("link", { name: /刪除了/ })
      .first()
      .click();
    await expect(authedPage.getByRole("heading", { name: "變更紀錄" })).toBeVisible();
    await expect(authedPage.getByText(/刪除了/)).toBeVisible();
  });
});
