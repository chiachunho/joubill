import { expect, setSessionCookie, test } from "./fixtures";

test.describe("Web App authentication", () => {
  test("redirects to /login when no session cookie is present", async ({ page }) => {
    await page.goto("/app");
    await expect(page).toHaveURL(/\/login/);
  });

  test("redirects to /login when the session has expired", async ({ page, baseURL, seeded }) => {
    await setSessionCookie(page.context(), baseURL, seeded.expiredSessionToken);
    await page.goto("/app");
    await expect(page).toHaveURL(/\/login/);
  });

  test("stays signed in when navigating between /app pages", async ({ authedPage, seeded }) => {
    await authedPage.goto("/app");
    await expect(authedPage.getByText(seeded.groupTitle, { exact: true }).first()).toBeVisible();

    await authedPage.goto(`/app/groups/${seeded.groupId}`);
    await expect(authedPage).not.toHaveURL(/\/login/);
    await expect(authedPage.getByRole("heading", { name: seeded.groupTitle })).toBeVisible();
  });
});
