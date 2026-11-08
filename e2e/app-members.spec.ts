import { expect, test } from "./fixtures";
import { mkPlaceholder } from "./helpers";

test.describe("Member list in group settings", () => {
  test("members are grouped by whether new expenses count them in", async ({
    authedPage,
    seeded,
  }) => {
    await authedPage.goto(`/app/groups/${seeded.groupId}/settings`);
    await expect(authedPage.getByText("一起分帳 (2)")).toBeVisible();
    await expect(authedPage.getByText(/^暫停分帳 \(/)).toHaveCount(0);

    await authedPage.getByRole("button", { name: `${seeded.partnerName} 的選項` }).click();
    await authedPage.getByRole("button", { name: "暫停分帳" }).click();

    await expect(authedPage.getByText("一起分帳 (1)")).toBeVisible();
    await expect(authedPage.getByText("暫停分帳 (1)")).toBeVisible();

    await authedPage.getByRole("button", { name: "恢復" }).click();
    await expect(authedPage.getByText("一起分帳 (2)")).toBeVisible();
    await expect(authedPage.getByText(/^暫停分帳 \(/)).toHaveCount(0);
  });

  test("the viewer's own menu has no way to remove themselves", async ({ authedPage, seeded }) => {
    await authedPage.goto(`/app/groups/${seeded.groupId}/settings`);
    await authedPage.getByRole("button", { name: "你 的選項" }).click();
    await expect(authedPage.getByRole("button", { name: "暫停分帳" })).toBeVisible();
    await expect(authedPage.getByRole("button", { name: "移出群組" })).toHaveCount(0);
  });

  test("a member on records can't be removed, and the dialog offers pausing instead", async ({
    authedPage,
    seeded,
  }) => {
    await authedPage.goto(`/app/groups/${seeded.groupId}/settings`);
    await authedPage.getByRole("button", { name: `${seeded.partnerName} 的選項` }).click();
    await authedPage.getByRole("button", { name: "移出群組" }).click();

    const dialog = authedPage.getByRole("dialog");
    await dialog.getByRole("button", { name: "移出", exact: true }).click();
    // The seeded expense is one record, though the partner is on it once.
    await expect(dialog.getByText(/還有 1 筆紀錄，不能移出/)).toBeVisible();
    await dialog.getByRole("button", { name: "改為暫停分帳" }).click();

    await expect(authedPage.getByText("暫停分帳 (1)")).toBeVisible();
    await expect(authedPage.getByText(seeded.partnerName)).toBeVisible();
  });

  test("a member without records is removed", async ({ authedPage, seeded }) => {
    const name = `E2E remove ${seeded.groupId}`;
    await mkPlaceholder(authedPage.request, seeded.groupId, name);

    await authedPage.goto(`/app/groups/${seeded.groupId}/settings`);
    await authedPage.getByRole("button", { name: `${name} 的選項` }).click();
    await authedPage.getByRole("button", { name: "移出群組" }).click();
    await authedPage.getByRole("dialog").getByRole("button", { name: "移出", exact: true }).click();

    await expect(authedPage.getByText(name)).toHaveCount(0);
  });
});
