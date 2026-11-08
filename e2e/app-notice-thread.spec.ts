import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-serverless";

import * as schema from "../src/db/schema";
import { expect, test } from "./fixtures";
import { auditActions } from "./helpers";

// 記帳通知發送位置 is chosen in Telegram with /topic (the Bot API can't list a chat's topics), so
// these cases put a topic on the seeded group directly and drive what the App can do with it.
test.describe("記帳通知發送位置 (the chat topic notices go to)", () => {
  test("the Telegram page shows the topic and puts it back to General", async ({
    authedPage,
    seeded,
    dbPool,
  }) => {
    const db = drizzle(dbPool, { schema });
    await db
      .update(schema.groups)
      .set({ noticeThreadId: 42, noticeThreadName: "旅遊記帳" })
      .where(eq(schema.groups.id, seeded.groupId));

    const chat = await (await authedPage.request.get(`/api/groups/${seeded.groupId}/chat`)).json();
    expect(chat.noticeThread).toEqual({ id: 42, name: "旅遊記帳" });

    await authedPage.goto(`/app/groups/${seeded.groupId}/settings/telegram`);
    await expect(authedPage.getByText("記帳通知發送位置")).toBeVisible();
    await expect(authedPage.getByText("旅遊記帳", { exact: true })).toBeVisible();

    await authedPage.getByRole("button", { name: "改回 General" }).click();
    // Wait for the server's answer itself: while it runs the dialog's button is a spinner and the
    // page behind the dialog is hidden from the a11y tree, so a "button gone" check passes early.
    const reset = authedPage.waitForResponse(
      (r) =>
        r.url().endsWith(`/api/groups/${seeded.groupId}/chat/topic`) &&
        r.request().method() === "DELETE",
    );
    await authedPage.getByRole("dialog").getByRole("button", { name: "改回 General" }).click();
    expect((await reset).status()).toBe(200);
    await expect(authedPage.getByRole("dialog")).toHaveCount(0);
    // The seeded chat isn't a real Telegram chat, so `isForum` is unknown; with no topic left the
    // section is hidden, as it is for any chat not known to have topics.
    await expect(authedPage.getByText("記帳通知發送位置")).toHaveCount(0);

    const [group] = await db
      .select()
      .from(schema.groups)
      .where(eq(schema.groups.id, seeded.groupId));
    expect(group.noticeThreadId).toBeNull();
    expect(group.noticeThreadName).toBeNull();
    expect(await auditActions(dbPool, seeded.groupId)).toContain("notice_thread_changed");

    await authedPage.goto(`/app/groups/${seeded.groupId}/activity`);
    await expect(authedPage.getByText("把記帳通知發送位置改回 General")).toBeVisible();
  });

  test("going back to General when already there logs nothing", async ({
    authedPage,
    seeded,
    dbPool,
  }) => {
    const res = await authedPage.request.delete(`/api/groups/${seeded.groupId}/chat/topic`);
    expect(res.status()).toBe(200);
    expect(await auditActions(dbPool, seeded.groupId)).not.toContain("notice_thread_changed");
  });

  test("unlinking the chat clears the topic, which belonged to that chat", async ({
    authedPage,
    seeded,
    dbPool,
  }) => {
    const db = drizzle(dbPool, { schema });
    await db
      .update(schema.groups)
      .set({ noticeThreadId: 42, noticeThreadName: "旅遊記帳" })
      .where(eq(schema.groups.id, seeded.groupId));

    expect((await authedPage.request.delete(`/api/groups/${seeded.groupId}/chat`)).status()).toBe(
      200,
    );
    const [group] = await db
      .select()
      .from(schema.groups)
      .where(eq(schema.groups.id, seeded.groupId));
    expect(group.noticeThreadId).toBeNull();

    // With no chat there is nothing to reset.
    expect(
      (await authedPage.request.delete(`/api/groups/${seeded.groupId}/chat/topic`)).status(),
    ).toBe(409);
  });

  test("an outsider can't change it", async ({ authedPage, seeded }) => {
    const res = await authedPage.request.delete(`/api/groups/${seeded.foreignGroupId}/chat/topic`);
    expect(res.status()).toBe(403);
  });
});
