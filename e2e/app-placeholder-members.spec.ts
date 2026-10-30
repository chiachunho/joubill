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
  test("a member can be merged into a real account from the member list", async ({
    authedPage,
    seeded,
  }) => {
    const name = `E2E claim ${seeded.groupId}`;
    const created = await authedPage.request.post(
      `/api/groups/${seeded.groupId}/members/placeholder`,
      { data: { firstName: name } },
    );
    expect(created.status()).toBe(201);

    await authedPage.goto(`/app/groups/${seeded.groupId}/settings`);
    await expect(authedPage.getByText(name)).toBeVisible();

    await authedPage.getByRole("button", { name: "合併到…" }).click();
    await authedPage.getByRole("radio", { name: new RegExp(seeded.partnerName) }).check();
    await expect(authedPage.getByText("合併後無法還原")).toBeVisible();
    await authedPage.getByRole("button", { name: "確認合併" }).click();

    await expect(authedPage.getByText(name)).toHaveCount(0);

    // The group feed says who took the name.
    await authedPage.goto(`/app/groups/${seeded.groupId}/activity`);
    await expect(authedPage.getByText(`認領了 ${name}`)).toBeVisible();
  });

  test("the API refuses to merge a real member or into a placeholder", async ({
    authedPage,
    seeded,
  }) => {
    const real = await authedPage.request.post(
      `/api/groups/${seeded.groupId}/members/${seeded.partnerId}/merge`,
      { data: { intoUserId: seeded.userId } },
    );
    expect(real.status()).toBe(403);

    const created = await authedPage.request.post(
      `/api/groups/${seeded.groupId}/members/placeholder`,
      { data: { firstName: `E2E target ${seeded.groupId}` } },
    );
    const { member } = (await created.json()) as { member: { id: number } };
    const other = await authedPage.request.post(
      `/api/groups/${seeded.groupId}/members/placeholder`,
      { data: { firstName: `E2E source ${seeded.groupId}` } },
    );
    const { member: source } = (await other.json()) as { member: { id: number } };

    const intoPlaceholder = await authedPage.request.post(
      `/api/groups/${seeded.groupId}/members/${source.id}/merge`,
      { data: { intoUserId: member.id } },
    );
    expect(intoPlaceholder.status()).toBe(400);
  });
  test("a settlement between the two merged people can be kept (delete-only) or removed", async ({
    authedPage,
    seeded,
  }) => {
    const mkPlaceholder = async (label: string) => {
      const res = await authedPage.request.post(
        `/api/groups/${seeded.groupId}/members/placeholder`,
        { data: { firstName: `E2E ${label} ${seeded.groupId}` } },
      );
      return ((await res.json()) as { member: { id: number } }).member.id;
    };
    const settle = async (fromUserId: number, toUserId: number) => {
      const res = await authedPage.request.post(`/api/groups/${seeded.groupId}/settlements`, {
        data: { fromUserId, toUserId, amount: 100, currency: "TWD" },
      });
      expect(res.ok()).toBe(true);
    };

    const keepId = await mkPlaceholder("keep");
    const dropId = await mkPlaceholder("drop");
    await settle(keepId, seeded.userId);
    await settle(dropId, seeded.userId);

    const keep = await authedPage.request.post(
      `/api/groups/${seeded.groupId}/members/${keepId}/merge`,
      { data: { intoUserId: seeded.userId, selfSettlements: "keep" } },
    );
    expect(await keep.json()).toMatchObject({ ok: true, removed: 0 });

    const drop = await authedPage.request.post(
      `/api/groups/${seeded.groupId}/members/${dropId}/merge`,
      { data: { intoUserId: seeded.userId, selfSettlements: "delete" } },
    );
    expect(await drop.json()).toMatchObject({ ok: true, removed: 1 });

    // The kept one is a settlement from the viewer to themself: it can no longer be edited.
    const list = await authedPage.request.get(`/api/groups/${seeded.groupId}/expenses`);
    const { expenses } = (await list.json()) as { expenses: { id: number; type: string }[] };
    const left = expenses.filter((e) => e.type === "settlement");
    expect(left).toHaveLength(1);
    const edit = await authedPage.request.patch(
      `/api/groups/${seeded.groupId}/settlements/${left[0].id}`,
      { data: { fromUserId: seeded.userId, toUserId: seeded.userId, amount: 50, currency: "TWD" } },
    );
    expect(edit.status()).toBe(400);
  });
});
