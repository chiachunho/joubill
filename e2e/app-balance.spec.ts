import { expect, test } from "./fixtures";

// The seeded expense is 300 paid by the user and split 150/150 with the partner,
// so the user is owed 150 and the partner owes 150.
test.describe("Balances and settle-up", () => {
  test("balance section shows the net amount for each member", async ({ authedPage, seeded }) => {
    await authedPage.goto(`/app/groups/${seeded.groupId}`);
    await expect(authedPage.getByText("+150.00", { exact: true })).toBeVisible();
    await expect(authedPage.getByText("-150.00", { exact: true })).toBeVisible();
  });

  test("to-settle lists the partner paying the user", async ({ authedPage, seeded }) => {
    await authedPage.goto(`/app/groups/${seeded.groupId}`);
    await expect(authedPage.getByText("To Settle", { exact: true })).toBeVisible();
    await expect(authedPage.getByText(seeded.partnerName, { exact: true }).first()).toBeVisible();
    await expect(authedPage.getByRole("button", { name: "已轉" })).toBeVisible();
  });

  test("marking a transfer as settled clears the balance and stays cleared", async ({
    authedPage,
    seeded,
  }) => {
    await authedPage.goto(`/app/groups/${seeded.groupId}`);
    await authedPage.getByRole("button", { name: "已轉" }).click();
    await expect(authedPage.getByText("所有帳款已結清")).toBeVisible();

    await authedPage.reload();
    await expect(authedPage.getByText("所有帳款已結清")).toBeVisible();
  });

  test("a split created through the API moves the balance", async ({ authedPage, seeded }) => {
    // Adds 90 paid by the user, split 30 to the user and 60 to the partner. The user
    // goes from +150 to +210 (paid 390, owes 180); the partner goes from -150 to -210.
    const res = await authedPage.request.post(`/api/groups/${seeded.groupId}/expenses`, {
      data: {
        amount: 90,
        currency: "TWD",
        description: `E2E taxi ${Date.now()}`,
        spentAt: new Date().toISOString(),
        shareType: "exact",
        payers: [{ payerId: seeded.userId, amount: 90 }],
        splits: [
          { debtorId: seeded.userId, amount: 30 },
          { debtorId: seeded.partnerId, amount: 60 },
        ],
      },
    });
    expect(res.ok()).toBeTruthy();

    await authedPage.goto(`/app/groups/${seeded.groupId}`);
    await expect(authedPage.getByText("+210.00", { exact: true })).toBeVisible();
    await expect(authedPage.getByText("-210.00", { exact: true })).toBeVisible();
  });

  test("API rejects an expense that splits to a user outside the group", async ({
    authedPage,
    seeded,
  }) => {
    const res = await authedPage.request.post(`/api/groups/${seeded.groupId}/expenses`, {
      data: {
        amount: 100,
        currency: "TWD",
        description: "E2E outsider",
        spentAt: new Date().toISOString(),
        shareType: "exact",
        payers: [{ payerId: seeded.userId, amount: 100 }],
        splits: [{ debtorId: seeded.outsiderId, amount: 100 }],
      },
    });
    expect(res.status()).toBe(400);
    expect(await res.text()).toContain(`users not in group: ${seeded.outsiderId}`);
  });
});
