import { expect, test } from "./fixtures";

// The seeded expense is 300 paid by the user and split 150/150 with the partner.
test.describe("CSV export", () => {
  test("the endpoint returns a BOM-prefixed CSV with the seeded expense", async ({
    authedPage,
    seeded,
  }) => {
    const res = await authedPage.request.get(`/api/groups/${seeded.groupId}/export?format=csv`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/csv");
    expect(res.headers()["content-disposition"]).toContain("attachment");

    const body = await res.text();
    expect(body.charCodeAt(0)).toBe(0xfeff);
    const [header, ...rows] = body.slice(1).trim().split("\r\n");
    expect(header).toContain("換算金額");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain(seeded.expenseDescription);
    expect(rows[0]).toContain(",300,TWD,300,TWD,1,");
  });

  test("a group the user does not belong to is refused", async ({ authedPage, seeded }) => {
    const res = await authedPage.request.get(
      `/api/groups/${seeded.foreignGroupId}/export?format=csv`,
    );
    expect(res.status()).toBe(403);
  });

  test("a format other than csv is rejected", async ({ authedPage, seeded }) => {
    const res = await authedPage.request.get(`/api/groups/${seeded.groupId}/export?format=xlsx`);
    expect(res.status()).toBe(400);
  });

  test("group settings downloads the file", async ({ authedPage, seeded }) => {
    await authedPage.goto(`/app/groups/${seeded.groupId}/settings`);
    const download = authedPage.waitForEvent("download");
    await authedPage.getByRole("button", { name: "下載 CSV" }).click();
    expect((await download).suggestedFilename()).toMatch(/\.csv$/);
  });
});
