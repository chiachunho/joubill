import { randomBytes } from "node:crypto";

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-serverless";

import * as schema from "../src/db/schema";
import { expect, test } from "./fixtures";
import { signedInPage } from "./helpers";

// Issue #67: the Web App on the home screen, and push notifications about one's own records.

function fakeEndpoint(): string {
  return `https://fcm.googleapis.com/fcm/send/e2e-${randomBytes(12).toString("hex")}`;
}

const KEYS = { p256dh: "BE2E-p256dh-not-a-real-key", auth: "e2e-auth" };

test.describe("Home-screen app", () => {
  test("the manifest opens /app and keeps login inside the app's scope", async ({ request }) => {
    const res = await request.get("/site.webmanifest");
    expect(res.status()).toBe(200);
    const manifest = await res.json();
    expect(manifest.start_url).toBe("/app");
    expect(manifest.scope).toBe("/");
    expect(manifest.display).toBe("standalone");
  });

  test("the service worker is served and never cached", async ({ request }) => {
    const res = await request.get("/sw.js");
    expect(res.status()).toBe(200);
    expect(res.headers()["cache-control"]).toContain("no-cache");
  });
});

test.describe("Push subscriptions", () => {
  test("a device is saved for the caller, taken over by whoever signs in next, and removed", async ({
    authedPage,
    browser,
    baseURL,
    dbPool,
    seeded,
  }) => {
    const db = drizzle(dbPool, { schema });
    const status = await (await authedPage.request.get("/api/me/push-subscriptions")).json();
    const endpoint = fakeEndpoint();
    const save = await authedPage.request.post("/api/me/push-subscriptions", {
      data: { endpoint, keys: KEYS },
    });
    if (!status.configured) {
      // A preview without VAPID keys refuses, and the settings page hides the section.
      expect(save.status()).toBe(503);
      return;
    }
    expect(save.status(), await save.text()).toBe(200);

    try {
      const rows = () =>
        db
          .select({ userId: schema.pushSubscriptions.userId })
          .from(schema.pushSubscriptions)
          .where(eq(schema.pushSubscriptions.endpoint, endpoint));
      expect(await rows()).toEqual([{ userId: seeded.userId }]);

      // Saving again is harmless: still one row.
      await authedPage.request.post("/api/me/push-subscriptions", {
        data: { endpoint, keys: KEYS },
      });
      expect(await rows()).toHaveLength(1);

      // Someone else signs in on the same browser: the device now notifies them only.
      const other = await signedInPage(browser, baseURL, dbPool, seeded.outsiderId);
      try {
        const takeover = await other.page.request.post("/api/me/push-subscriptions", {
          data: { endpoint, keys: KEYS },
        });
        expect(takeover.status()).toBe(200);
        expect(await rows()).toEqual([{ userId: seeded.outsiderId }]);

        // The previous owner can no longer remove it.
        await authedPage.request.delete("/api/me/push-subscriptions", { data: { endpoint } });
        expect(await rows()).toHaveLength(1);

        await other.page.request.delete("/api/me/push-subscriptions", { data: { endpoint } });
        expect(await rows()).toHaveLength(0);
      } finally {
        await other.context.close();
      }
    } finally {
      await db
        .delete(schema.pushSubscriptions)
        .where(eq(schema.pushSubscriptions.endpoint, endpoint));
    }
  });

  test("an endpoint that isn't a known push service is refused", async ({ authedPage }) => {
    const status = await (await authedPage.request.get("/api/me/push-subscriptions")).json();
    test.skip(!status.configured, "push is not configured on this deployment");
    const res = await authedPage.request.post("/api/me/push-subscriptions", {
      data: { endpoint: "https://example.com/push", keys: KEYS },
    });
    expect(res.status()).toBe(400);
  });
});

test.describe("Muting push for a group", () => {
  test("is personal, saved, and shown in group settings", async ({
    authedPage,
    dbPool,
    seeded,
  }) => {
    const db = drizzle(dbPool, { schema });
    const url = `/api/groups/${seeded.groupId}/notifications`;
    expect(await (await authedPage.request.get(url)).json()).toEqual({ muted: false });

    const res = await authedPage.request.patch(url, { data: { muted: true } });
    expect(res.status(), await res.text()).toBe(200);
    expect(await (await authedPage.request.get(url)).json()).toEqual({ muted: true });

    const rows = await db
      .select({ userId: schema.groupMembers.userId, muted: schema.groupMembers.pushMuted })
      .from(schema.groupMembers)
      .where(eq(schema.groupMembers.groupId, seeded.groupId));
    expect(rows.find((r) => r.userId === seeded.userId)?.muted).toBe(true);
    expect(rows.find((r) => r.userId === seeded.partnerId)?.muted).toBe(false);
  });

  test("is refused for a group the caller isn't in", async ({ authedPage, seeded }) => {
    const res = await authedPage.request.patch(
      `/api/groups/${seeded.foreignGroupId}/notifications`,
      {
        data: { muted: true },
      },
    );
    expect(res.status()).toBe(403);
  });
});
