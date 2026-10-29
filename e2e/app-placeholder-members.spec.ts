import { expect, test } from "./fixtures";

test.describe("Members without an account", () => {
  test("can be added from the member list and are marked as having no account", async ({
    authedPage,
    seeded,
  }) => {
    const name = `E2E ghost ${seeded.groupId}`;
    await authedPage.goto(`/app/groups/${seeded.groupId}/settings`);
    await authedPage.getByText("新增成員（不需帳號）").click();
    await authedPage.getByLabel("名字").fill(name);
    await authedPage.getByRole("button", { name: "新增", exact: true }).click();

    // The "無帳號" badge sits inside the same <p>, so match the name as a substring.
    await expect(authedPage.getByText(name)).toBeVisible();
    await expect(authedPage.getByText("無帳號")).toBeVisible();
  });

  test("a duplicate name is rejected", async ({ authedPage, seeded }) => {
    await authedPage.goto(`/app/groups/${seeded.groupId}/settings`);
    await authedPage.getByText("新增成員（不需帳號）").click();
    await authedPage.getByLabel("名字").fill(seeded.partnerName);
    await authedPage.getByRole("button", { name: "新增", exact: true }).click();

    await expect(authedPage.getByText("名字已被群組成員使用")).toBeVisible();
  });

  test("the API refuses to rename a member who has an account", async ({ authedPage, seeded }) => {
    const res = await authedPage.request.patch(
      `/api/groups/${seeded.groupId}/members/${seeded.partnerId}`,
      { data: { firstName: "renamed" } },
    );
    expect(res.status()).toBe(403);
  });
});
