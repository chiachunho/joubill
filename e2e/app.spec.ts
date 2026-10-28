import { expect, test } from "./fixtures";

test.describe("/app 未登入", () => {
  test("沒有 session 時導向登入頁", async ({ page }) => {
    await page.goto("/app");
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe("/app 已登入", () => {
  test("群組列表顯示自己所在的群組", async ({ authedPage, seeded }) => {
    await authedPage.goto("/app");
    await expect(authedPage.getByText(seeded.groupTitle, { exact: true }).first()).toBeVisible();
  });

  test("進入群組頁會顯示群組標題", async ({ authedPage, seeded }) => {
    await authedPage.goto(`/app/groups/${seeded.groupId}`);
    await expect(authedPage.getByRole("heading", { name: seeded.groupTitle })).toBeVisible();
  });
});
