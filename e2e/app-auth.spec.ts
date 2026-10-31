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

test.describe("Login methods", () => {
  test("lists the linked methods and offers no unlink for the only one", async ({
    authedPage,
    seeded,
    dbPool,
  }) => {
    await dbPool.query(
      "INSERT INTO auth_identities (user_id, provider, provider_uid) VALUES ($1, 'telegram', $2)",
      [seeded.userId, `e2e-${seeded.userId}`],
    );
    await authedPage.goto("/app/settings");
    await expect(authedPage.getByText("登入方式", { exact: true })).toBeVisible();
    await expect(authedPage.getByText("Telegram", { exact: true })).toBeVisible();
    await expect(authedPage.getByRole("button", { name: /解除連結/ })).toHaveCount(0);
  });

  test("unlinks a second method but keeps Telegram", async ({ authedPage, seeded, dbPool }) => {
    await dbPool.query(
      "INSERT INTO auth_identities (user_id, provider, provider_uid) VALUES ($1, 'telegram', $2), ($1, 'google', $3)",
      [seeded.userId, `e2e-${seeded.userId}`, `e2e-g-${seeded.userId}`],
    );
    await authedPage.goto("/app/settings");
    await authedPage.getByRole("button", { name: /解除連結/ }).click();
    await authedPage.getByRole("dialog").getByRole("button", { name: "解除連結" }).click();
    await expect(authedPage.getByText("Google", { exact: true })).toHaveCount(0);
    await expect(authedPage.getByText("Telegram", { exact: true })).toBeVisible();
  });

  test("refuses to delete the last login method over the API", async ({
    authedPage,
    seeded,
    dbPool,
  }) => {
    await dbPool.query(
      "INSERT INTO auth_identities (user_id, provider, provider_uid) VALUES ($1, 'google', $2)",
      [seeded.userId, `e2e-g-${seeded.userId}`],
    );
    const res = await authedPage.request.delete("/api/me/identities/google");
    expect(res.status()).toBe(409);
  });
});

// Auth.js sends every failed OAuth callback to /login?error=, including a link started from the
// settings page. A signed-in person goes back to that page instead (issue #105).
test.describe("A login method that did not link", () => {
  test("sends a signed-in visitor from the login page back to settings", async ({ authedPage }) => {
    await authedPage.goto("/login?error=OAuthCallbackError");
    await expect(authedPage).toHaveURL(/\/app\/settings$/);
    await expect(
      authedPage.getByText("沒有連結：授權沒有完成，可能是在授權頁取消了。"),
    ).toBeVisible();
  });

  test("does not show the message again after a reload", async ({ authedPage }) => {
    await authedPage.goto("/app/settings?linkError=AccessDenied");
    // Matched by text: Next.js's route announcer is a role="alert" too.
    await expect(authedPage.getByText("連結失敗，請再試一次。")).toBeVisible();
    await expect(authedPage).toHaveURL(/\/app\/settings$/);
    await authedPage.reload();
    await expect(authedPage.getByText("登入方式", { exact: true })).toBeVisible();
    await expect(authedPage.getByText("連結失敗，請再試一次。")).toHaveCount(0);
  });

  test("keeps a signed-out visitor on the login page", async ({ page }) => {
    await page.goto("/login?error=OAuthCallbackError");
    await expect(page).toHaveURL(/\/login\?error=OAuthCallbackError/);
    await expect(page.getByText("登入失敗，請再試一次。")).toBeVisible();
  });
});
