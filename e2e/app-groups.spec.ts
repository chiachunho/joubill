import { expect, test } from "./fixtures";

test.describe("Group list and group page", () => {
  test("group list shows the groups the user belongs to", async ({ authedPage, seeded }) => {
    await authedPage.goto("/app");
    await expect(authedPage.getByText(seeded.groupTitle, { exact: true }).first()).toBeVisible();
  });

  test("group list does not show groups the user is not in", async ({ authedPage, seeded }) => {
    await authedPage.goto("/app");
    await expect(authedPage.getByText(seeded.groupTitle, { exact: true }).first()).toBeVisible();
    await expect(authedPage.getByText(seeded.foreignGroupTitle, { exact: true })).toHaveCount(0);
  });

  test("group page shows the group title", async ({ authedPage, seeded }) => {
    await authedPage.goto(`/app/groups/${seeded.groupId}`);
    await expect(authedPage.getByRole("heading", { name: seeded.groupTitle })).toBeVisible();
  });

  test("group page lists the expenses recorded in the group", async ({ authedPage, seeded }) => {
    await authedPage.goto(`/app/groups/${seeded.groupId}`);
    await expect(
      authedPage.getByText(seeded.expenseDescription, { exact: true }).first(),
    ).toBeVisible();
  });

  test("group page links to the new-expense and new-settlement forms", async ({
    authedPage,
    seeded,
  }) => {
    await authedPage.goto(`/app/groups/${seeded.groupId}`);
    await expect(
      authedPage.locator(`a[href="/app/groups/${seeded.groupId}/expenses/new"]`).first(),
    ).toBeVisible();
    await expect(
      authedPage.locator(`a[href="/app/groups/${seeded.groupId}/settlements/new"]`).first(),
    ).toBeVisible();
  });

  test("expense edit page is pre-filled with the saved expense", async ({ authedPage, seeded }) => {
    await authedPage.goto(`/app/groups/${seeded.groupId}/expenses/${seeded.expenseId}/edit`);
    await expect(authedPage.getByPlaceholder("例如：晚餐、機票")).toHaveValue(
      seeded.expenseDescription,
    );
  });

  test("API refuses a group the user is not a member of", async ({ authedPage, seeded }) => {
    const res = await authedPage.request.get(`/api/groups/${seeded.foreignGroupId}/members`);
    expect(res.status()).toBe(403);
  });

  test("creates an expense through the form and returns to the group page", async ({
    authedPage,
    seeded,
  }) => {
    const description = `E2E lunch ${Date.now()}`;
    await authedPage.goto(`/app/groups/${seeded.groupId}/expenses/new`);
    await authedPage.getByLabel("金額", { exact: true }).fill("150");
    await authedPage.getByLabel("說明", { exact: true }).fill(description);
    await authedPage.getByRole("button", { name: "儲存", exact: true }).click();

    await expect(authedPage).toHaveURL(new RegExp(`/app/groups/${seeded.groupId}$`));
    await expect(authedPage.getByText(description, { exact: true }).first()).toBeVisible();
  });
});
