import { and, eq, isNull } from "drizzle-orm";
import type { Pool } from "@neondatabase/serverless";
import type { APIRequestContext, APIResponse } from "@playwright/test";
import { drizzle } from "drizzle-orm/neon-serverless";

import * as schema from "../src/db/schema";
import { CLAIM_UNAVAILABLE } from "../src/lib/invite";
import { expect, test } from "./fixtures";
import {
  addExpense,
  addSettlement,
  auditActions,
  balances,
  legs,
  mergedBalances,
  mkPlaceholder,
  openAddMember,
  signedInPage,
} from "./helpers";

const INVALID = "邀請碼無效或已失效";

test.describe("Creating groups and joining by invite", () => {
  test("a user can create a web group from the home page", async ({ authedPage, dbPool }) => {
    const title = `E2E web group ${Date.now()}`;
    const db = drizzle(dbPool, { schema });
    try {
      await authedPage.goto("/app");
      await authedPage.getByRole("link", { name: "建立群組" }).click();
      await authedPage.getByPlaceholder("例如：東京旅行").fill(title);
      await authedPage.getByRole("button", { name: "建立群組" }).click();

      await expect(authedPage).toHaveURL(/\/app\/groups\/\d+$/);
      await expect(authedPage.getByRole("heading", { name: title })).toBeVisible();

      const [group] = await db.select().from(schema.groups).where(eq(schema.groups.title, title));
      expect(group.chatType).toBeNull();
      expect(group.chatId).toBeNull();
    } finally {
      await db.delete(schema.groups).where(eq(schema.groups.title, title));
    }
  });

  test("another account joins by link and a reset kills the old code", async ({
    authedPage,
    seeded,
    dbPool,
    browser,
    baseURL,
  }) => {
    const db = drizzle(dbPool, { schema });
    const first = await authedPage.request.post(`/api/groups/${seeded.groupId}/invite`);
    const { code: oldCode } = await first.json();

    const { context, page } = await signedInPage(browser, baseURL, dbPool, seeded.outsiderId);
    try {
      await page.goto(`/join/${oldCode}`);
      await expect(page.getByText(seeded.groupTitle, { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "加入" }).click();
      await expect(page).toHaveURL(new RegExp(`/app/groups/${seeded.groupId}$`));

      const members = await db
        .select()
        .from(schema.groupMembers)
        .where(eq(schema.groupMembers.groupId, seeded.groupId));
      expect(members.map((m) => m.userId)).toContain(seeded.outsiderId);

      // Reset: the old code is dead, the new one works.
      const reset = await authedPage.request.post(`/api/groups/${seeded.groupId}/invite`);
      const { code: newCode } = await reset.json();
      expect(newCode).not.toBe(oldCode);

      await page.goto(`/join/${oldCode}`);
      await expect(page.getByText(INVALID)).toBeVisible();
      await page.goto(`/join/${newCode}`);
      await expect(page.getByText("你已經在這個群組裡了")).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test("a code typed by hand is accepted in its dashed form", async ({
    authedPage,
    seeded,
    dbPool,
    browser,
    baseURL,
  }) => {
    const res = await authedPage.request.post(`/api/groups/${seeded.groupId}/invite`);
    const { code } = await res.json();
    const dashed = `${code.slice(0, 5)}-${code.slice(5)}`.toLowerCase();

    const { context, page } = await signedInPage(browser, baseURL, dbPool, seeded.outsiderId);
    try {
      await page.goto("/app/groups/join");
      await page.getByPlaceholder("K7M2Q-X9PAB").fill(dashed);
      await page.getByRole("button", { name: "繼續" }).click();
      await expect(page).toHaveURL(new RegExp(`/join/${code}$`));
      await expect(page.getByText(seeded.groupTitle, { exact: true })).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test("two accepts in a row log one join", async ({
    authedPage,
    seeded,
    dbPool,
    browser,
    baseURL,
  }) => {
    const db = drizzle(dbPool, { schema });
    const { code } = await (
      await authedPage.request.post(`/api/groups/${seeded.groupId}/invite`)
    ).json();

    const { context, page } = await signedInPage(browser, baseURL, dbPool, seeded.outsiderId);
    try {
      const accept = () => page.request.post(`/api/invites/${code}/accept`);
      await Promise.all([accept(), accept()]);

      const rows = await db
        .select()
        .from(schema.recordAuditLog)
        .where(eq(schema.recordAuditLog.groupId, seeded.groupId));
      expect(rows.filter((r) => r.action === "member_joined")).toHaveLength(1);
    } finally {
      await context.close();
    }
  });

  test("resetting at the same time still leaves one live code", async ({
    authedPage,
    seeded,
    dbPool,
  }) => {
    const db = drizzle(dbPool, { schema });
    await Promise.all([
      authedPage.request.post(`/api/groups/${seeded.groupId}/invite`),
      authedPage.request.post(`/api/groups/${seeded.groupId}/invite`),
    ]);

    const live = await db
      .select()
      .from(schema.groupInvites)
      .where(
        and(eq(schema.groupInvites.groupId, seeded.groupId), isNull(schema.groupInvites.revokedAt)),
      );
    expect(live).toHaveLength(1);
  });

  test("reading an invite never creates one", async ({ authedPage, seeded }) => {
    const res = await authedPage.request.get(`/api/groups/${seeded.groupId}/invite`);
    expect((await res.json()).code).toBeNull();
  });

  test("the invite carries a Telegram link only when the bot can build one", async ({
    authedPage,
    seeded,
  }) => {
    const res = await authedPage.request.post(`/api/groups/${seeded.groupId}/invite`);
    expect(res.ok()).toBe(true);
    const { code, miniLink } = await res.json();
    // The preview's bot token may be a dummy, in which case there is no username to build from;
    // either way the code must come back and the link must be absent or point at this code.
    if (miniLink !== null) expect(miniLink).toContain(`startapp=join_${code}`);

    await authedPage.goto(`/app/groups/${seeded.groupId}/settings`);
    await openAddMember(authedPage, "用邀請碼邀請");
    await expect(authedPage.getByRole("button", { name: "複製網頁連結" })).toBeVisible();
    const telegramButton = authedPage.getByRole("button", { name: "複製 Telegram 連結" });
    if (miniLink !== null) await expect(telegramButton).toBeVisible();
    else await expect(telegramButton).toHaveCount(0);
  });

  test("an unknown code gets the same answer as a revoked one", async ({ authedPage }) => {
    await authedPage.goto("/join/0000000000");
    await expect(authedPage.getByText(INVALID)).toBeVisible();
  });

  test("the second member approves deleting a web group", async ({
    authedPage,
    seeded,
    dbPool,
    browser,
    baseURL,
  }) => {
    const db = drizzle(dbPool, { schema });
    const title = `E2E delete ${Date.now()}`;
    const created = await authedPage.request.post("/api/groups", {
      data: { title, defaultCurrency: "TWD" },
    });
    const { id } = await created.json();
    const { code } = await (await authedPage.request.get(`/api/groups/${id}/invite`)).json();

    const { context, page } = await signedInPage(browser, baseURL, dbPool, seeded.outsiderId);
    try {
      await page.goto(`/join/${code}`);
      await page.getByRole("button", { name: "加入" }).click();
      await expect(page).toHaveURL(new RegExp(`/app/groups/${id}$`));

      // Two members now, so deleting needs the other one's approval.
      const del = await authedPage.request.delete(`/api/groups/${id}`);
      expect((await del.json()).pending).toBe(true);

      await page.reload();
      await expect(page.getByText(/申請刪除此群組/)).toBeVisible();
      await page.getByRole("button", { name: "同意刪除" }).click();
      await expect(page).toHaveURL(/\/app$/);

      const left = await db.select().from(schema.groups).where(eq(schema.groups.id, id));
      expect(left).toHaveLength(0);
    } finally {
      await context.close();
      await db.delete(schema.groups).where(eq(schema.groups.id, id));
    }
  });
});

async function isMember(dbPool: Pool, groupId: number, userId: number) {
  const rows = await drizzle(dbPool, { schema })
    .select()
    .from(schema.groupMembers)
    .where(and(eq(schema.groupMembers.groupId, groupId), eq(schema.groupMembers.userId, userId)));
  return rows.length > 0;
}

async function userExists(dbPool: Pool, userId: number) {
  const rows = await drizzle(dbPool, { schema })
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.id, userId));
  return rows.length > 0;
}

test.describe("Claiming a member without an account from the invite page", () => {
  test("joining as that member moves their records to the new account", async ({
    authedPage,
    seeded,
    dbPool,
    browser,
    baseURL,
  }) => {
    const name = `E2E ghost ${Date.now()}`;
    const ghostId = await mkPlaceholder(authedPage.request, seeded.groupId, name);
    const expenseId = await addExpense(authedPage.request, seeded.groupId, {
      amount: 200,
      shareType: "exact",
      payers: [{ payerId: ghostId, amount: 200 }],
      splits: [
        { debtorId: seeded.userId, amount: 100 },
        { debtorId: ghostId, amount: 100 },
      ],
    });
    await addSettlement(authedPage.request, seeded.groupId, ghostId, seeded.userId, 50);
    const before = await balances(authedPage.request, seeded.groupId);
    const { code } = await (
      await authedPage.request.post(`/api/groups/${seeded.groupId}/invite`)
    ).json();

    const { context, page } = await signedInPage(browser, baseURL, dbPool, seeded.outsiderId);
    try {
      await page.goto(`/join/${code}`);
      await page.getByRole("radio", { name }).check();
      await page.getByRole("button", { name: `加入並認領「${name}」` }).click();
      await expect(page).toHaveURL(new RegExp(`/app/groups/${seeded.groupId}$`));

      expect(await userExists(dbPool, ghostId)).toBe(false);
      expect(await legs(dbPool, expenseId)).toEqual({
        payers: [{ payerId: seeded.outsiderId, amount: 200 }],
        splits: [
          { debtorId: seeded.userId, amount: 100, shareType: "exact", splitValue: null },
          { debtorId: seeded.outsiderId, amount: 100, shareType: "exact", splitValue: null },
        ].sort((a, b) => a.debtorId - b.debtorId),
      });
      expect(await balances(authedPage.request, seeded.groupId)).toEqual(
        mergedBalances(before, ghostId, seeded.outsiderId),
      );

      await page.goto(`/app/groups/${seeded.groupId}/settings`);
      await expect(page.getByRole("button", { name: "新增成員", exact: true })).toBeVisible();
      await expect(page.getByText(name)).toHaveCount(0);

      await page.goto(`/app/groups/${seeded.groupId}/activity`);
      await expect(page.getByText(`認領了 ${name}`)).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test("choosing none of them joins without touching the member", async ({
    authedPage,
    seeded,
    dbPool,
    browser,
    baseURL,
  }) => {
    const name = `E2E ghost ${Date.now()}`;
    const ghostId = await mkPlaceholder(authedPage.request, seeded.groupId, name);
    const expenseId = await addExpense(authedPage.request, seeded.groupId, {
      amount: 80,
      shareType: "exact",
      payers: [{ payerId: ghostId, amount: 80 }],
      splits: [{ debtorId: seeded.userId, amount: 80 }],
    });
    const legsBefore = await legs(dbPool, expenseId);
    const { code } = await (
      await authedPage.request.post(`/api/groups/${seeded.groupId}/invite`)
    ).json();

    const { context, page } = await signedInPage(browser, baseURL, dbPool, seeded.outsiderId);
    try {
      await page.goto(`/join/${code}`);
      await expect(page.getByRole("radio", { name })).toBeVisible();
      await expect(page.getByRole("radio", { name: "都不是，我是新成員" })).toBeChecked();
      await page.getByRole("button", { name: "加入", exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/app/groups/${seeded.groupId}$`));

      expect(await isMember(dbPool, seeded.groupId, ghostId)).toBe(true);
      expect(await isMember(dbPool, seeded.groupId, seeded.outsiderId)).toBe(true);
      expect(await legs(dbPool, expenseId)).toEqual(legsBefore);
      const actions = await auditActions(dbPool, seeded.groupId);
      expect(actions).toContain("member_joined");
      expect(actions).not.toContain("member_claimed");
    } finally {
      await context.close();
    }
  });

  // How the picked member disappears before the visitor taps 加入並認領. `other` is the member
  // a merge folds them into.
  type TakeAway = (
    request: APIRequestContext,
    groupId: number,
    id: number,
    other: number,
  ) => Promise<APIResponse>;
  const takeAways: [string, TakeAway][] = [
    [
      "merged into someone else",
      (request, groupId, id, other) =>
        request.post(`/api/groups/${groupId}/members/${id}/merge`, { data: { intoUserId: other } }),
    ],
    ["removed", (request, groupId, id) => request.delete(`/api/groups/${groupId}/members/${id}`)],
  ];
  for (const [how, takeAway] of takeAways) {
    test(`a member ${how} after the page loaded refuses the whole join`, async ({
      authedPage,
      seeded,
      dbPool,
      browser,
      baseURL,
    }) => {
      const name = `E2E ghost ${Date.now()}`;
      const ghostId = await mkPlaceholder(authedPage.request, seeded.groupId, name);
      const { code } = await (
        await authedPage.request.post(`/api/groups/${seeded.groupId}/invite`)
      ).json();

      const { context, page } = await signedInPage(browser, baseURL, dbPool, seeded.outsiderId);
      try {
        await page.goto(`/join/${code}`);
        await page.getByRole("radio", { name }).check();
        // Someone else gets there first. No reload here: a refetched preview would drop the
        // pick and this would pass as a plain join.
        const gone = await takeAway(authedPage.request, seeded.groupId, ghostId, seeded.partnerId);
        expect(gone.ok(), await gone.text()).toBe(true);

        await page.getByRole("button", { name: `加入並認領「${name}」` }).click();
        await expect(page.getByText(CLAIM_UNAVAILABLE)).toBeVisible();
        await expect(page).toHaveURL(new RegExp(`/join/${code}$`));

        // The join and the claim share one transaction: nothing of the join is left behind.
        expect(await isMember(dbPool, seeded.groupId, seeded.outsiderId)).toBe(false);
        expect(await auditActions(dbPool, seeded.groupId)).not.toContain("member_joined");

        // The re-read list no longer offers the name, and a plain join still works.
        await expect(page.getByRole("radio", { name })).toHaveCount(0);
        await page.getByRole("button", { name: "加入", exact: true }).click();
        await expect(page).toHaveURL(new RegExp(`/app/groups/${seeded.groupId}$`));
        expect(await isMember(dbPool, seeded.groupId, seeded.outsiderId)).toBe(true);
      } finally {
        await context.close();
      }
    });
  }
});
