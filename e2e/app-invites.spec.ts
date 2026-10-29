import { randomBytes } from "node:crypto";

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-serverless";

import * as schema from "../src/db/schema";
import { expect, setSessionCookie, test } from "./fixtures";

const INVALID = "邀請碼無效或已失效";

/** A browser context signed in as the seeded outsider, who is not in the seeded group. */
async function outsiderPage(
  browser: import("@playwright/test").Browser,
  baseURL: string | undefined,
  dbPool: import("@neondatabase/serverless").Pool,
  outsiderId: number,
) {
  const token = randomBytes(24).toString("hex");
  const db = drizzle(dbPool, { schema });
  // Removed with the user by the fixture's teardown (sessions cascade).
  await db
    .insert(schema.sessions)
    .values({ id: token, userId: outsiderId, expiresAt: new Date(Date.now() + 3_600_000) });
  const context = await browser.newContext({ baseURL });
  await setSessionCookie(context, baseURL, token);
  return { context, page: await context.newPage() };
}

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
    const first = await authedPage.request.get(`/api/groups/${seeded.groupId}/invite`);
    const { code: oldCode } = await first.json();

    const { context, page } = await outsiderPage(browser, baseURL, dbPool, seeded.outsiderId);
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
    const res = await authedPage.request.get(`/api/groups/${seeded.groupId}/invite`);
    const { code } = await res.json();
    const dashed = `${code.slice(0, 5)}-${code.slice(5)}`.toLowerCase();

    const { context, page } = await outsiderPage(browser, baseURL, dbPool, seeded.outsiderId);
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

    const { context, page } = await outsiderPage(browser, baseURL, dbPool, seeded.outsiderId);
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
