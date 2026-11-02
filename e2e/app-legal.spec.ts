import { expect, test } from "./fixtures";

// The privacy policy and terms are what Google's OAuth consent screen links to, so they must
// load signed out, and be reachable from the login page and from 個人設定 → 關於.
test.describe("Privacy policy and terms", () => {
  test("both pages load without signing in", async ({ page }) => {
    await page.goto("/help/privacy");
    await expect(page.getByRole("heading", { level: 1, name: "隱私權政策" })).toBeVisible();
    await page.goto("/help/terms");
    await expect(page.getByRole("heading", { level: 1, name: "服務條款" })).toBeVisible();
  });

  test("the login page links to both", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("link", { name: "隱私權政策" }).click();
    await expect(page).toHaveURL(/\/help\/privacy$/);
    await page.goto("/login");
    await page.getByRole("link", { name: "服務條款" }).click();
    await expect(page).toHaveURL(/\/help\/terms$/);
  });

  test("personal settings lists them next to 使用說明", async ({ authedPage }) => {
    await authedPage.goto("/app/settings");
    await authedPage.getByRole("link", { name: /隱私權政策/ }).click();
    await expect(authedPage).toHaveURL(/\/help\/privacy$/);
    await authedPage.goto("/app/settings");
    await authedPage.getByRole("link", { name: /服務條款/ }).click();
    await expect(authedPage).toHaveURL(/\/help\/terms$/);
  });
});
