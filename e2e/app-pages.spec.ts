import { expect, test } from "./fixtures";

// Smoke checks: each settings and stats page renders its heading for a member.
test.describe("Group and account pages", () => {
  test("stats page renders", async ({ authedPage, seeded }) => {
    await authedPage.goto(`/app/groups/${seeded.groupId}/stats`);
    await expect(authedPage.getByRole("heading", { name: "統計" })).toBeVisible();
  });

  test("group settings page renders", async ({ authedPage, seeded }) => {
    await authedPage.goto(`/app/groups/${seeded.groupId}/settings`);
    await expect(authedPage.getByRole("heading", { name: "群組設定" })).toBeVisible();
  });

  test("currency and rates settings page renders", async ({ authedPage, seeded }) => {
    await authedPage.goto(`/app/groups/${seeded.groupId}/settings/rates`);
    await expect(authedPage.getByRole("heading", { name: "貨幣與匯率" })).toBeVisible();
  });

  test("Telegram settings page renders", async ({ authedPage, seeded }) => {
    await authedPage.goto(`/app/groups/${seeded.groupId}/settings/telegram`);
    await expect(authedPage.getByRole("heading", { name: "Telegram 群組" })).toBeVisible();
  });

  test("export settings page renders", async ({ authedPage, seeded }) => {
    await authedPage.goto(`/app/groups/${seeded.groupId}/settings/export`);
    await expect(authedPage.getByRole("heading", { name: "匯出" })).toBeVisible();
  });

  test("personal settings page renders", async ({ authedPage }) => {
    await authedPage.goto("/app/settings");
    await expect(authedPage.getByRole("heading", { name: "個人設定" })).toBeVisible();
  });
});
