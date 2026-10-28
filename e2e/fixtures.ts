import { randomBytes } from "node:crypto";

import { Pool } from "@neondatabase/serverless";
import { inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-serverless";
import { test as base, type BrowserContext, type Page } from "@playwright/test";

import * as schema from "../src/db/schema";

// Web App auth is a `session` cookie whose value is a row id in `sessions`.
// Seeding that row directly skips the Telegram login, which can't be automated.
const SESSION_COOKIE = "session";
const SESSION_TTL_MS = 60 * 60 * 1000;

export type Seeded = {
  /** The signed-in user. Pays 300 of the seeded expense and owes 150 of it. */
  userId: number;
  groupId: number;
  groupTitle: string;
  /** Second group member who has no session. Owes 150 of the seeded expense. */
  partnerId: number;
  partnerName: string;
  /** A user who is not a member of `groupId` at all. */
  outsiderId: number;
  expenseId: number;
  expenseDescription: string;
  /** A group the signed-in user does NOT belong to. */
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

function randomChatId(): string {
  return `-100${randomTelegramId()}`;
}

export function setSessionCookie(context: BrowserContext, url: string | undefined, token: string) {
  return context.addCookies([{ name: SESSION_COOKIE, value: token, url }]);
}

export const test = base.extend<{ seeded: Seeded; authedPage: Page }, { dbPool: Pool }>({
  // One pool per worker rather than per test: every test opens a connection otherwise.
  dbPool: [
    async ({}, use) => {
      const pool = new Pool({ connectionString: connectionString() });
      try {
        await use(pool);
      } finally {
        await pool.end();
      }
    },
    { scope: "worker" },
  ],

  // Two members in one group, an outsider, a second group the user is not in,
  // one 300 expense split 150/150 between the two members, and two sessions
  // (live and expired). Teardown removes it all: deleting the groups cascades to
  // members, expenses and their legs; then the users go. Ids are recorded as each
  // row is created, so teardown also removes whatever was inserted before a
  // seeding step failed.
  seeded: async ({ dbPool }, use) => {
    const db = drizzle(dbPool, { schema });
    const userIds: number[] = [];
    const groupIds: number[] = [];

    try {
      const suffix = randomBytes(4).toString("hex");
      const groupTitle = `E2E group ${suffix}`;
      const foreignGroupTitle = `E2E foreign ${suffix}`;
      const expenseDescription = `E2E dinner ${suffix}`;
      const partnerName = `E2E partner ${suffix}`;

      const [user] = await db
        .insert(schema.users)
        .values({ telegramId: randomTelegramId(), firstName: `E2E ${suffix}` })
        .returning();
      userIds.push(user.id);
      const [partner] = await db
        .insert(schema.users)
        .values({ telegramId: randomTelegramId(), firstName: partnerName })
        .returning();
      userIds.push(partner.id);
      const [outsider] = await db
        .insert(schema.users)
        .values({ telegramId: randomTelegramId(), firstName: `E2E outsider ${suffix}` })
        .returning();
      userIds.push(outsider.id);

      const [group] = await db
        .insert(schema.groups)
        .values({ chatType: "telegram", chatId: randomChatId(), title: groupTitle })
        .returning();
      groupIds.push(group.id);
      const [foreign] = await db
        .insert(schema.groups)
        .values({ chatType: "telegram", chatId: randomChatId(), title: foreignGroupTitle })
        .returning();
      groupIds.push(foreign.id);
      await db.insert(schema.groupMembers).values([
        { groupId: group.id, userId: user.id },
        { groupId: group.id, userId: partner.id },
      ]);

      const [expense] = await db
        .insert(schema.expenses)
        .values({
          groupId: group.id,
          type: "expense",
          amount: "300.00",
          currency: "TWD",
          description: expenseDescription,
          createdBy: user.id,
        })
        .returning();
      await db
        .insert(schema.expensePayers)
        .values({ expenseId: expense.id, payerId: user.id, amount: "300.00" });
      await db.insert(schema.expenseSplits).values([
        { expenseId: expense.id, debtorId: user.id, amount: "150.00" },
        { expenseId: expense.id, debtorId: partner.id, amount: "150.00" },
      ]);

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

      await use({
        userId: user.id,
        groupId: group.id,
        groupTitle,
        partnerId: partner.id,
        partnerName,
        outsiderId: outsider.id,
        expenseId: expense.id,
        expenseDescription,
        foreignGroupId: foreign.id,
        foreignGroupTitle,
        sessionToken,
        expiredSessionToken,
      });
    } finally {
      if (groupIds.length) {
        await db.delete(schema.groups).where(inArray(schema.groups.id, groupIds));
      }
      if (userIds.length) {
        await db.delete(schema.users).where(inArray(schema.users.id, userIds));
      }
    }
  },

  // A page whose browser context already carries the seeded live session cookie.
  authedPage: async ({ page, baseURL, seeded }, use) => {
    await setSessionCookie(page.context(), baseURL, seeded.sessionToken);
    await use(page);
  },
});

export { expect } from "@playwright/test";
