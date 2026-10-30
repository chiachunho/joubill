import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-serverless";

import * as schema from "../src/db/schema";
import { expect, setMergeTicketCookie, setSessionCookie, test } from "./fixtures";

test.describe("Merging two accounts", () => {
  test("folds a web-first account into the Telegram one, keeping every group", async ({
    page,
    baseURL,
    mergePair,
    dbPool,
  }) => {
    await setSessionCookie(page.context(), baseURL, mergePair.sessionToken);
    await setMergeTicketCookie(page.context(), baseURL!, mergePair.ticket);

    await page.goto("/app/settings/merge");
    await expect(page.getByRole("heading", { name: "合併帳號" })).toBeVisible();
    // The Telegram account is suggested, since the bot and Mini App know the person by it.
    await expect(page.getByRole("radio", { name: new RegExp(mergePair.tgName) })).toBeChecked();
    await expect(page.getByText(mergePair.sharedGroupTitle)).toBeVisible();

    await page.getByRole("button", { name: "合併帳號…" }).click();
    await expect(page.getByText("合併後無法還原")).toBeVisible();
    await page.getByRole("button", { name: "合併", exact: true }).click();

    await expect(page).toHaveURL(/\/app\/settings\?merge=done/);
    await expect(page.getByText("已合併")).toBeVisible();

    // The web session now belongs to the Telegram account, which sees all three groups.
    await page.goto("/app");
    for (const title of [
      mergePair.sharedGroupTitle,
      mergePair.webGroupTitle,
      mergePair.tgGroupTitle,
    ]) {
      await expect(page.getByText(title)).toBeVisible();
    }

    const db = drizzle(dbPool, { schema });
    const gone = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, mergePair.webUserId));
    expect(gone).toHaveLength(0);
    const logins = await db
      .select({ provider: schema.authIdentities.provider })
      .from(schema.authIdentities)
      .where(eq(schema.authIdentities.userId, mergePair.tgUserId));
    expect(logins.map((l) => l.provider).sort()).toEqual(["google", "telegram"]);

    // One person now owes the whole 300 they paid: one member, one split row, totals intact.
    const members = await db
      .select()
      .from(schema.groupMembers)
      .where(eq(schema.groupMembers.groupId, mergePair.sharedGroupId));
    expect(members.map((m) => m.userId)).toEqual([mergePair.tgUserId]);
    const splits = await db
      .select()
      .from(schema.expenseSplits)
      .where(eq(schema.expenseSplits.expenseId, mergePair.expenseId));
    expect(splits).toHaveLength(1);
    expect(splits[0]).toMatchObject({ debtorId: mergePair.tgUserId, amount: "300.00" });

    // The ticket was single-use.
    const again = await page.request.post("/api/me/merge", {
      data: { keepUserId: mergePair.tgUserId },
    });
    expect(again.status()).toBe(404);
  });

  test("a ticket held by another account is refused", async ({ page, baseURL, mergePair }) => {
    await setSessionCookie(page.context(), baseURL, mergePair.sessionToken);
    await setMergeTicketCookie(page.context(), baseURL!, mergePair.foreignTicket);

    const res = await page.request.post("/api/me/merge", {
      data: { keepUserId: mergePair.webUserId },
    });
    expect(res.status()).toBe(404);

    await page.goto("/app/settings/merge");
    await expect(page).toHaveURL(/\/app\/settings\?merge=expired/);
    await expect(page.getByText("合併已逾時")).toBeVisible();
  });

  test("cancelling keeps both accounts", async ({ page, baseURL, mergePair, dbPool }) => {
    await setSessionCookie(page.context(), baseURL, mergePair.sessionToken);
    await setMergeTicketCookie(page.context(), baseURL!, mergePair.ticket);

    await page.goto("/app/settings/merge");
    await page.getByRole("button", { name: "‹ 取消" }).click();
    await expect(page).toHaveURL(/\/app\/settings$/);

    const db = drizzle(dbPool, { schema });
    const still = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, mergePair.webUserId));
    expect(still).toHaveLength(1);
    const res = await page.request.get("/api/me/merge");
    expect(res.status()).toBe(404);
  });
});
