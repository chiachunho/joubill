import { randomBytes } from "node:crypto";

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-serverless";
import type { Page } from "@playwright/test";

import * as schema from "../src/db/schema";
import { expect, setSessionCookie, test } from "./fixtures";

const CARD = "還沒有其他成員";

/** Creates a web group with the signed-in user as its only member; returns its id. */
async function createSoloGroup(page: Page): Promise<number> {
  const res = await page.request.post("/api/groups", {
    data: { title: `E2E solo ${randomBytes(4).toString("hex")}` },
  });
  expect(res.ok()).toBe(true);
  const { id } = await res.json();
  return id as number;
}

test.describe("A group with only its creator", () => {
  test("shows the card, and it goes away once a member without an account is added", async ({
    authedPage,
    dbPool,
  }) => {
    const db = drizzle(dbPool, { schema });
    const groupId = await createSoloGroup(authedPage);
    try {
      await authedPage.goto(`/app/groups/${groupId}`);
      await expect(authedPage.getByText(CARD)).toBeVisible();
      await expect(authedPage.getByText("所有帳款已結清")).toHaveCount(0);
      await expect(authedPage.getByRole("button", { name: "複製邀請碼" })).toBeVisible();

      await authedPage.getByRole("button", { name: "新增沒有帳號的成員" }).click();
      await authedPage.getByLabel("名字").fill("E2E ghost");
      await authedPage.getByRole("button", { name: "新增", exact: true }).click();

      await expect(authedPage.getByText(CARD)).toHaveCount(0);
      await expect(authedPage.getByText("所有帳款已結清")).toBeVisible();
    } finally {
      // Members without an account are removed with the group (cascade).
      await db.delete(schema.groups).where(eq(schema.groups.id, groupId));
    }
  });

  test("goes away after a second account joins with the invite code", async ({
    authedPage,
    seeded,
    dbPool,
    browser,
    baseURL,
  }) => {
    const db = drizzle(dbPool, { schema });
    const groupId = await createSoloGroup(authedPage);
    try {
      await authedPage.goto(`/app/groups/${groupId}`);
      await expect(authedPage.getByText(CARD)).toBeVisible();

      const { code } = await (await authedPage.request.get(`/api/groups/${groupId}/invite`)).json();
      const token = randomBytes(24).toString("hex");
      await db.insert(schema.sessions).values({
        id: token,
        userId: seeded.outsiderId,
        expiresAt: new Date(Date.now() + 3_600_000),
      });
      const context = await browser.newContext({ baseURL });
      try {
        await setSessionCookie(context, baseURL, token);
        const res = await context.request.post(`/api/invites/${code}/accept`);
        expect(res.ok()).toBe(true);
      } finally {
        await context.close();
      }

      await authedPage.reload();
      await expect(authedPage.getByText("所有帳款已結清")).toBeVisible();
      await expect(authedPage.getByText(CARD)).toHaveCount(0);
    } finally {
      await db.delete(schema.groups).where(eq(schema.groups.id, groupId));
    }
  });

  test("a group with two members has no card", async ({ authedPage, seeded }) => {
    await authedPage.goto(`/app/groups/${seeded.groupId}`);
    await expect(authedPage.getByText(seeded.expenseDescription)).toBeVisible();
    await expect(authedPage.getByText(CARD)).toHaveCount(0);
  });
});
