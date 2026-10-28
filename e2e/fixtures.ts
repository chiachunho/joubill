import { randomBytes } from "node:crypto";

import { Pool } from "@neondatabase/serverless";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-serverless";
import { test as base, type BrowserContext, type Page } from "@playwright/test";

import * as schema from "../src/db/schema";

// Web App auth is a `session` cookie whose value is a row id in `sessions`.
// Seeding that row directly skips the Telegram login, which can't be automated.
const SESSION_COOKIE = "session";
const SESSION_TTL_MS = 60 * 60 * 1000;

export type Seeded = {
  userId: number;
  /** A group the user belongs to, with one expense recorded in it. */
  groupId: number;
  groupTitle: string;
  expenseId: number;
  expenseDescription: string;
  /** A group the user does NOT belong to. */
  foreignGroupId: number;
  foreignGroupTitle: string;
  sessionToken: string;
  expiredSessionToken: string;
};

function connectionString(): string {
  const url = process.env.E2E_DATABASE_URL;
  if (!url) throw new Error("E2E_DATABASE_URL must point at the DB the target site uses");
  return url;
}

function randomTelegramId(): number {
  return 900_000_000 + Math.floor(Math.random() * 100_000_000);
}

export function setSessionCookie(context: BrowserContext, url: string | undefined, token: string) {
  return context.addCookies([{ name: SESSION_COOKIE, value: token, url }]);
}

export const test = base.extend<{ seeded: Seeded; authedPage: Page }>({
  // One user, two groups (one the user is in, one they are not), an expense in
  // the first group, and two sessions (live and expired). Teardown removes all of
  // it; deleting the groups cascades to members, expenses and their legs.
  seeded: async ({}, use) => {
    const pool = new Pool({ connectionString: connectionString() });
    const db = drizzle(pool, { schema });

    const suffix = randomBytes(4).toString("hex");
    const telegramId = randomTelegramId();
    const groupTitle = `E2E group ${suffix}`;
    const foreignGroupTitle = `E2E foreign ${suffix}`;
    const expenseDescription = `E2E dinner ${suffix}`;

    const [user] = await db
      .insert(schema.users)
      .values({ telegramId, firstName: `E2E ${suffix}` })
      .returning();
    const [group] = await db
      .insert(schema.groups)
      .values({
        chatType: "telegram",
        chatId: `-100${randomTelegramId()}`,
        title: groupTitle,
      })
      .returning();
    const [foreign] = await db
      .insert(schema.groups)
      .values({
        chatType: "telegram",
        chatId: `-100${randomTelegramId()}`,
        title: foreignGroupTitle,
      })
      .returning();
    await db.insert(schema.groupMembers).values({ groupId: group.id, userId: user.id });

    const [expense] = await db
      .insert(schema.expenses)
      .values({
        groupId: group.id,
        type: "expense",
        amount: "320.00",
        currency: "TWD",
        description: expenseDescription,
        createdBy: user.id,
      })
      .returning();
    await db
      .insert(schema.expensePayers)
      .values({ expenseId: expense.id, payerId: user.id, amount: "320.00" });
    await db
      .insert(schema.expenseSplits)
      .values({ expenseId: expense.id, debtorId: user.id, amount: "320.00" });

    const sessionToken = randomBytes(32).toString("hex");
    const expiredSessionToken = randomBytes(32).toString("hex");
    await db.insert(schema.sessions).values([
      { id: sessionToken, userId: user.id, expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
      {
        id: expiredSessionToken,
        userId: user.id,
        expiresAt: new Date(Date.now() - SESSION_TTL_MS),
      },
    ]);

    try {
      await use({
        userId: user.id,
        groupId: group.id,
        groupTitle,
        expenseId: expense.id,
        expenseDescription,
        foreignGroupId: foreign.id,
        foreignGroupTitle,
        sessionToken,
        expiredSessionToken,
      });
    } finally {
      await db.delete(schema.groups).where(inArray(schema.groups.id, [group.id, foreign.id]));
      await db.delete(schema.users).where(eq(schema.users.id, user.id));
      await pool.end();
    }
  },

  // A page whose browser context already carries the seeded live session cookie.
  authedPage: async ({ page, baseURL, seeded }, use) => {
    await setSessionCookie(page.context(), baseURL, seeded.sessionToken);
    await use(page);
  },
});

export { expect } from "@playwright/test";
