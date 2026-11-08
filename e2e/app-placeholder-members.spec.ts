import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-serverless";

import * as schema from "../src/db/schema";
import { expect, test } from "./fixtures";
import { addExpense, addSettlement, auditActions, mkPlaceholder, openAddMember } from "./helpers";

test.describe("Members without an account", () => {
  test("can be added from the member list and are marked as having no account", async ({
    authedPage,
    seeded,
  }) => {
    const name = `E2E ghost ${seeded.groupId}`;
    await authedPage.goto(`/app/groups/${seeded.groupId}/settings`);
    await openAddMember(authedPage, "新增沒有帳號的成員");
    await authedPage.getByLabel("名字").fill(name);
    await authedPage.getByRole("button", { name: "新增", exact: true }).click();

    // The "無帳號" badge sits inside the same <p>, so match the name as a substring.
    await expect(authedPage.getByText(name)).toBeVisible();
    await expect(authedPage.getByText("無帳號")).toBeVisible();
  });

  test("a duplicate name is rejected", async ({ authedPage, seeded }) => {
    await authedPage.goto(`/app/groups/${seeded.groupId}/settings`);
    await openAddMember(authedPage, "新增沒有帳號的成員");
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

    await authedPage.getByRole("button", { name: `${name} 的選項` }).click();
    await authedPage.getByRole("button", { name: "合併到真人成員…" }).click();
    await authedPage.getByRole("radio", { name: new RegExp(seeded.partnerName) }).check();
    await expect(authedPage.getByText("合併後無法還原")).toBeVisible();
    await authedPage.getByRole("button", { name: "確認合併" }).click();

    await expect(authedPage.getByText(name)).toHaveCount(0);

    // The viewer merged it into the partner, so the feed names the target rather than
    // saying the viewer "claimed" it.
    await authedPage.goto(`/app/groups/${seeded.groupId}/activity`);
    await expect(authedPage.getByText(`把 ${name} 合併到 ${seeded.partnerName}`)).toBeVisible();
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
    dbPool,
  }) => {
    const { request } = authedPage;
    const keepId = await mkPlaceholder(request, seeded.groupId, `E2E keep ${seeded.groupId}`);
    const dropId = await mkPlaceholder(request, seeded.groupId, `E2E drop ${seeded.groupId}`);
    await addSettlement(request, seeded.groupId, keepId, seeded.userId, 100);
    const droppedId = await addSettlement(request, seeded.groupId, dropId, seeded.userId, 100);

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

    // The removal went through the ordinary delete path, so it is audited like any other.
    expect(await auditActions(dbPool, seeded.groupId, droppedId)).toContain("deleted");

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

  test("a group whose member without an account has records can still be deleted", async ({
    authedPage,
    seeded,
    dbPool,
  }) => {
    const db = drizzle(dbPool, { schema });
    const created = await authedPage.request.post("/api/groups", {
      data: { title: `E2E delete ghost ${Date.now()}`, defaultCurrency: "TWD" },
    });
    const { id } = (await created.json()) as { id: number };
    try {
      // The placeholder pays and owes, so its `users` row is named by both kinds of leg, which
      // the group's cascade used to trip over.
      const ghost = await mkPlaceholder(authedPage.request, id, `E2E ghost ${id}`);
      await addExpense(authedPage.request, id, {
        amount: 100,
        shareType: "exact",
        payers: [{ payerId: ghost, amount: 100 }],
        splits: [
          { debtorId: seeded.userId, amount: 60 },
          { debtorId: ghost, amount: 40 },
        ],
      });

      // Members without an account don't count, so the sole owner deletes it at once.
      const del = await authedPage.request.delete(`/api/groups/${id}`);
      expect(del.status(), await del.text()).toBe(200);
      expect(await db.select().from(schema.groups).where(eq(schema.groups.id, id))).toHaveLength(0);
      expect(await db.select().from(schema.users).where(eq(schema.users.id, ghost))).toHaveLength(
        0,
      );
    } finally {
      await db.delete(schema.expenses).where(eq(schema.expenses.groupId, id));
      await db.delete(schema.groups).where(eq(schema.groups.id, id));
    }
  });
});
