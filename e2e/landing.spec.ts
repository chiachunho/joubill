import { expect, test } from "./fixtures";

// The landing page is the public front door (and a portfolio piece), so it must load signed
// out, its demo must respond, and its way into the product and the repository must work.
test.describe("Landing page", () => {
  test("loads signed out and walks the demo card through its life", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("記帳分帳就是這麼簡單");

    const card = page.getByTestId("life-demo-card");
    await expect(card).toContainText("300 TWD");
    await page.getByRole("tab", { name: "發現記錯" }).click();
    await expect(card).toContainText("3,000 TWD");
    await page.getByRole("tab", { name: "刪掉" }).click();
    await expect(card).toContainText("小明 記錄 · 阿華 刪除");
  });

  test("points to Telegram, the web app and the repository", async ({ page }) => {
    await page.goto("/");
    const add = page.getByRole("link", { name: "加到 Telegram 群組" }).first();
    await expect(add).toHaveAttribute("href", /^(https:\/\/t\.me\/.+\?startgroup=true|\/help)$/);
    await expect(page.getByRole("link", { name: /^在 GitHub 上給 Star/ }).first()).toHaveAttribute(
      "href",
      "https://github.com/chiachunho/splitbill-telegram-bot",
    );
    await page.getByRole("link", { name: "開啟網頁版" }).click();
    await expect(page).toHaveURL(/\/(app|login)/);
  });
});
