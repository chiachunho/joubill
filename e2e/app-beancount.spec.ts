import { expect, test } from "./fixtures";
import { addExpense, addSettlement } from "./helpers";

// The seeded expense is 300 paid by the user and split 150/150 with the partner.
// Nothing seeds a beancount row: every case starts from the defaults and no export.

const leaf = (title: string) => title.replace(/[^\p{L}\p{N}]/gu, "");

test.describe("beancount export", () => {
  test("the accounts default to the group's name until saved", async ({ authedPage, seeded }) => {
    const res = await authedPage.request.get(`/api/groups/${seeded.groupId}/beancount`);
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual({
      config: {
        expensesAccount: "Expenses:Uncategorized",
        cashAccount: "Assets:Cash",
        eventAccount: `Assets:Receivable:${leaf(seeded.groupTitle)}`,
      },
    });
  });

  test("the file posts the seeded expense to the event account", async ({ authedPage, seeded }) => {
    const res = await authedPage.request.get(
      `/api/groups/${seeded.groupId}/beancount/export?range=all`,
    );
    expect(res.status()).toBe(200);
    expect(res.headers()["content-disposition"]).toContain(".beancount");

    const text = await res.text();
    const event = `Assets:Receivable:${leaf(seeded.groupTitle)}`;
    expect(text).toContain(`splitbill_id: "${seeded.expenseId}"`);
    expect(text).toMatch(/Expenses:Uncategorized\s+150\.00 TWD/);
    expect(text).toMatch(/Assets:Cash\s+-300\.00 TWD/);
    expect(text).toMatch(new RegExp(`${event}\\s+150\\.00 TWD`));
    // The file starts the ledger, so the event account is opened for real.
    expect(text).toMatch(new RegExp(`^\\d{4}-\\d{2}-\\d{2} open ${event}$`, "m"));
  });

  test("上次匯出後 picks up only what was added since", async ({ authedPage, seeded }) => {
    const { request } = authedPage;
    const summary = async (range: string) => {
      const res = await request.get(
        `/api/groups/${seeded.groupId}/beancount/export/summary?range=${range}`,
      );
      expect(res.status()).toBe(200);
      return (await res.json()) as { included: number; lastExportedAt: string | null };
    };

    expect(await summary("new")).toMatchObject({ included: 1, lastExportedAt: null });
    await request.get(`/api/groups/${seeded.groupId}/beancount/export?range=all`);
    expect((await summary("new")).included).toBe(0);
    expect((await summary("new")).lastExportedAt).not.toBeNull();

    await addSettlement(request, seeded.groupId, seeded.partnerId, seeded.userId, 150);
    const third = await addExpense(request, seeded.groupId, {
      amount: 100,
      shareType: "exact",
      payers: [{ payerId: seeded.partnerId, amount: 100 }],
      splits: [{ debtorId: seeded.partnerId, amount: 100 }],
    });
    // The partner's own expense doesn't touch the user's ledger.
    expect(await summary("new")).toMatchObject({ included: 1, skipped: 1 });

    const text = await (
      await request.get(`/api/groups/${seeded.groupId}/beancount/export?range=new`)
    ).text();
    expect(text).not.toContain(`splitbill_id: "${seeded.expenseId}"`);
    expect(text).not.toContain(`splitbill_id: "${third}"`);
    expect(text).toMatch(/Assets:Cash\s+150\.00 TWD/);
    expect(text).toMatch(/^; \d{4}-\d{2}-\d{2} open Assets:Receivable:/m);
    expect((await summary("new")).included).toBe(0);
  });

  test("a custom range doesn't move the watermark", async ({ authedPage, seeded }) => {
    const { request } = authedPage;
    const from = new Date(Date.now() - 86_400_000).toISOString();
    const to = new Date(Date.now() + 86_400_000).toISOString();
    const qs = new URLSearchParams({ range: "custom", from, to }).toString();
    const res = await request.get(`/api/groups/${seeded.groupId}/beancount/export?${qs}`);
    expect(res.status()).toBe(200);
    expect(await res.text()).toContain(`splitbill_id: "${seeded.expenseId}"`);

    const summary = await request.get(
      `/api/groups/${seeded.groupId}/beancount/export/summary?range=new`,
    );
    expect(await summary.json()).toMatchObject({ included: 1, lastExportedAt: null });
  });

  test("bad ranges and other people's groups are refused", async ({ authedPage, seeded }) => {
    const { request } = authedPage;
    const bad = await request.get(
      `/api/groups/${seeded.groupId}/beancount/export?range=custom&from=2026-10-01&to=2026-10-31`,
    );
    expect(bad.status()).toBe(400);
    const foreign = await request.get(
      `/api/groups/${seeded.foreignGroupId}/beancount/export?range=all`,
    );
    expect(foreign.status()).toBe(403);
  });

  test("saved accounts reach the file and the form says so", async ({ authedPage, seeded }) => {
    await authedPage.goto(`/app/groups/${seeded.groupId}/settings/beancount`);
    const save = authedPage.getByRole("button", { name: "儲存" });
    await expect(save).toBeDisabled();

    await authedPage.getByLabel("Expenses 帳戶").fill("Expenses:Food:Dining");
    await save.click();
    await expect(authedPage.getByText("已儲存")).toBeVisible();
    await expect(save).toBeDisabled();

    const text = await (
      await authedPage.request.get(`/api/groups/${seeded.groupId}/beancount/export?range=all`)
    ).text();
    expect(text).toMatch(/Expenses:Food:Dining\s+150\.00 TWD/);
  });

  test("the export page downloads the file", async ({ authedPage, seeded }) => {
    await authedPage.goto(`/app/groups/${seeded.groupId}/settings`);
    await authedPage.getByRole("link", { name: "匯出 beancount" }).click();
    await expect(authedPage.getByRole("radio", { name: /全部/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(authedPage.getByText("1 筆")).toBeVisible();

    const download = authedPage.waitForEvent("download");
    await authedPage.getByRole("button", { name: "下載 .beancount" }).click();
    expect((await download).suggestedFilename()).toMatch(/\.beancount$/);
    // The watermark moved, so the page now offers 上次匯出後 with nothing new in it.
    await authedPage.reload();
    await expect(authedPage.getByRole("radio", { name: /上次匯出後/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });
});
