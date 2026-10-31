import { randomBytes } from "node:crypto";

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-serverless";

import * as schema from "../src/db/schema";
import { expect, test } from "./fixtures";

// Issue #101: a name the person chooses, shown everywhere their provider name used to be.
test.describe("Display name", () => {
  test("set in personal settings, it replaces the provider name there", async ({ authedPage }) => {
    const name = `E2E 暱稱 ${randomBytes(3).toString("hex")}`;

    await authedPage.goto("/app/settings");
    await authedPage.getByRole("button", { name: "編輯顯示名稱" }).click();
    await authedPage.getByRole("textbox", { name: "顯示名稱" }).fill(name);
    await authedPage.getByRole("button", { name: "儲存" }).click();
    await expect(authedPage.getByText(name, { exact: true })).toBeVisible();

    const profile = await (await authedPage.request.get("/api/me/profile")).json();
    expect(profile.displayName).toBe(name);
  });

  // The member list shows the viewer as 你, so the other side checks it: a member's chosen
  // name is what everyone else in the group sees.
  test("another member's chosen name shows in the member list", async ({
    authedPage,
    seeded,
    dbPool,
  }) => {
    const db = drizzle(dbPool, { schema });
    const name = `E2E 夥伴暱稱 ${randomBytes(3).toString("hex")}`;
    await db
      .update(schema.users)
      .set({ displayName: name })
      .where(eq(schema.users.id, seeded.partnerId));

    await authedPage.goto(`/app/groups/${seeded.groupId}/settings`);
    await expect(authedPage.getByText(name, { exact: true })).toBeVisible();
    await expect(authedPage.getByText(seeded.partnerName, { exact: true })).toHaveCount(0);
  });

  test("going back to the provider's name clears the choice", async ({ authedPage }) => {
    const set = await authedPage.request.patch("/api/me/profile", {
      data: { displayName: "E2E 暫時的名字" },
    });
    expect(set.status(), await set.text()).toBe(200);

    await authedPage.goto("/app/settings");
    await authedPage.getByRole("button", { name: "編輯顯示名稱" }).click();
    await authedPage.getByRole("button", { name: "改回原本的名字" }).click();
    await expect(authedPage.getByText("E2E 暫時的名字")).toHaveCount(0);

    const profile = await (await authedPage.request.get("/api/me/profile")).json();
    expect(profile.displayName).toBeNull();
  });

  test("the API refuses a whitespace-only name and an avatar source that isn't linked", async ({
    authedPage,
  }) => {
    const blank = await authedPage.request.patch("/api/me/profile", {
      data: { displayName: "   " },
    });
    expect(blank.status()).toBe(400);

    const unlinked = await authedPage.request.patch("/api/me/profile", {
      data: { avatarSource: "github" },
    });
    expect(unlinked.status()).toBe(400);
  });
});
