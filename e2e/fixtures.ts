import { randomBytes } from "node:crypto";

import { Pool } from "@neondatabase/serverless";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-serverless";
import { test as base, type Page } from "@playwright/test";

import * as schema from "../src/db/schema";

// Web App auth is a `session` cookie whose value is a row id in `sessions`.
// Seeding that row directly skips the Telegram login, which can't be automated.
const SESSION_COOKIE = "session";

export type Seeded = {
  userId: number;
  groupId: number;
  groupTitle: string;
  sessionToken: string;
};

function connectionString(): string {
  const url = process.env.E2E_DATABASE_URL;
  if (!url) throw new Error("E2E_DATABASE_URL must point at the DB the target site uses");
  return url;
}

export const test = base.extend<{ seeded: Seeded; authedPage: Page }>({
  // One user, one group they belong to, and one live session per test. Everything
  // is removed on teardown; the group delete cascades to membership.
  seeded: async ({}, use) => {
    const pool = new Pool({ connectionString: connectionString() });
    const db = drizzle(pool, { schema });

    const suffix = randomBytes(4).toString("hex");
    const telegramId = 900_000_000 + Math.floor(Math.random() * 100_000_000);
    const groupTitle = `E2E group ${suffix}`;

    const [user] = await db
      .insert(schema.users)
      .values({ telegramId, firstName: `E2E ${suffix}` })
      .returning();
    const [group] = await db
      .insert(schema.groups)
      .values({ chatType: "telegram", chatId: `-100${telegramId}`, title: groupTitle })
      .returning();
    await db.insert(schema.groupMembers).values({ groupId: group.id, userId: user.id });

    const sessionToken = randomBytes(32).toString("hex");
    await db.insert(schema.sessions).values({
      id: sessionToken,
      userId: user.id,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    try {
      await use({ userId: user.id, groupId: group.id, groupTitle, sessionToken });
    } finally {
      await db.delete(schema.groups).where(eq(schema.groups.id, group.id));
      await db.delete(schema.users).where(eq(schema.users.id, user.id));
      await pool.end();
    }
  },

  // A page whose browser context already carries the seeded session cookie.
  authedPage: async ({ page, baseURL, seeded }, use) => {
    await page
      .context()
      .addCookies([{ name: SESSION_COOKIE, value: seeded.sessionToken, url: baseURL }]);
    await use(page);
  },
});

export { expect } from "@playwright/test";
