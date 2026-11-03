import { randomBytes } from "node:crypto";

import { Pool } from "@neondatabase/serverless";
import { inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-serverless";
import { test as base, type BrowserContext, type Page } from "@playwright/test";

import * as schema from "../src/db/schema";
import { requireTelegramChatId } from "../src/lib/chat";

// Web App auth is a `session` cookie whose value is a row id in `sessions`.
// Seeding that row directly skips the Telegram login, which can't be automated.
const SESSION_COOKIE = "session";
const SESSION_TTL_MS = 60 * 60 * 1000;

export type Seeded = {
  /** The signed-in user. Pays 300 of the seeded expense and owes 150 of it. */
  userId: number;
  /** The signed-in user's Telegram id and first name, for signing Mini App initData. */
  telegramId: number;
  firstName: string;
  groupId: number;
  groupTitle: string;
  /** The group's Telegram chat id, as a `startapp=group_<chatId>` deep link carries it. */
  chatId: number;
  /** Second group member who has no session. Owes 150 of the seeded expense. */
  partnerId: number;
  partnerName: string;
  /** A user who is not a member of `groupId` at all. */
  outsiderId: number;
  outsiderTelegramId: number;
  outsiderFirstName: string;
  expenseId: number;
  expenseDescription: string;
  /** A group the signed-in user does NOT belong to. */
  foreignGroupId: number;
  foreignGroupTitle: string;
  sessionToken: string;
  expiredSessionToken: string;
};

/**
 * Records first, then the groups. A test may leave a member without an account who paid or owes
 * in a record; deleting the group alone would then fail (see `src/lib/group-delete.ts`, which
 * this mirrors because that module needs the app's env).
 */
async function deleteGroups(db: ReturnType<typeof drizzle<typeof schema>>, groupIds: number[]) {
  await db.delete(schema.expenses).where(inArray(schema.expenses.groupId, groupIds));
  await db.delete(schema.groups).where(inArray(schema.groups.id, groupIds));
}

function connectionString(): string {
  const url = process.env.E2E_DATABASE_URL;
  if (!url) throw new Error("E2E_DATABASE_URL must point at the DB the target site uses");
  return url;
}

/**
 * Telegram promises user ids fit in 52 significant bits, so anything from 2^52 up (still a
 * safe JS integer) can't be a real account. That matters because the Mini App specs sign
 * initData for these ids with the production bot's token, and a failing run's trace keeps
 * it: an id in the real range would be a working login as some stranger for a day. It also
 * keeps the seed from colliding with a real user in a branch database copied from production.
 */
function randomTelegramId(): number {
  return 2 ** 52 + Math.floor(Math.random() * 1_000_000_000);
}

function randomChatId(): string {
  return `-100${900_000_000 + Math.floor(Math.random() * 100_000_000)}`;
}

/**
 * Two accounts of one person (issue #99): a web-first Google account that is signed in, and a
 * Telegram account that already has groups. Seeding the ticket stands in for the OAuth round
 * trip the `signIn` callback would have recorded.
 */
export type MergePair = {
  webUserId: number;
  webName: string;
  tgUserId: number;
  tgName: string;
  /** Both accounts are members; a 300 expense paid by the Telegram account, split 150/150. */
  sharedGroupId: number;
  sharedGroupTitle: string;
  expenseId: number;
  /** Only the web account is a member. */
  webGroupTitle: string;
  /** Only the Telegram account is a member. */
  tgGroupTitle: string;
  /** The web account's session. */
  sessionToken: string;
  /** Held by the web account: proof it also owns the Telegram account. */
  ticket: string;
  /** Held by the Telegram account, so useless to the web account's session. */
  foreignTicket: string;
};

export function setSessionCookie(context: BrowserContext, url: string | undefined, token: string) {
  return context.addCookies([{ name: SESSION_COOKIE, value: token, url }]);
}

export function setMergeTicketCookie(context: BrowserContext, baseURL: string, ticket: string) {
  // Scoped to the merge API, as the signIn callback sets it.
  const url = new URL(baseURL);
  return context.addCookies([
    {
      name: "merge_ticket",
      value: ticket,
      domain: url.hostname,
      path: "/api/me/merge",
      secure: url.protocol === "https:",
      httpOnly: true,
    },
  ]);
}

export const test = base.extend<
  { seeded: Seeded; authedPage: Page; mergePair: MergePair },
  { dbPool: Pool }
>({
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
        telegramId: user.telegramId!,
        firstName: user.firstName,
        groupId: group.id,
        groupTitle,
        chatId: requireTelegramChatId(group),
        partnerId: partner.id,
        partnerName,
        outsiderId: outsider.id,
        outsiderTelegramId: outsider.telegramId!,
        outsiderFirstName: outsider.firstName,
        expenseId: expense.id,
        expenseDescription,
        foreignGroupId: foreign.id,
        foreignGroupTitle,
        sessionToken,
        expiredSessionToken,
      });
    } finally {
      if (groupIds.length) {
        await deleteGroups(db, groupIds);
      }
      if (userIds.length) {
        await db.delete(schema.users).where(inArray(schema.users.id, userIds));
      }
    }
  },

  mergePair: async ({ dbPool }, use) => {
    const db = drizzle(dbPool, { schema });
    const userIds: number[] = [];
    const groupIds: number[] = [];

    try {
      const suffix = randomBytes(4).toString("hex");
      const webName = `E2E web ${suffix}`;
      const tgName = `E2E tg ${suffix}`;
      const telegramId = randomTelegramId();

      const [web] = await db
        .insert(schema.users)
        .values({ firstName: webName, email: `e2e-${suffix}@example.com` })
        .returning();
      userIds.push(web.id);
      const [tg] = await db
        .insert(schema.users)
        .values({ telegramId, firstName: tgName })
        .returning();
      userIds.push(tg.id);
      await db.insert(schema.authIdentities).values([
        { userId: web.id, provider: "google", providerUid: `e2e-google-${suffix}` },
        { userId: tg.id, provider: "telegram", providerUid: String(telegramId) },
      ]);

      const [shared] = await db
        .insert(schema.groups)
        .values({ chatType: "telegram", chatId: randomChatId(), title: `E2E shared ${suffix}` })
        .returning();
      groupIds.push(shared.id);
      const [webGroup] = await db
        .insert(schema.groups)
        .values({ title: `E2E web group ${suffix}` })
        .returning();
      groupIds.push(webGroup.id);
      const [tgGroup] = await db
        .insert(schema.groups)
        .values({ chatType: "telegram", chatId: randomChatId(), title: `E2E tg group ${suffix}` })
        .returning();
      groupIds.push(tgGroup.id);
      await db.insert(schema.groupMembers).values([
        { groupId: shared.id, userId: web.id },
        { groupId: shared.id, userId: tg.id },
        { groupId: webGroup.id, userId: web.id },
        { groupId: tgGroup.id, userId: tg.id },
      ]);

      const [expense] = await db
        .insert(schema.expenses)
        .values({
          groupId: shared.id,
          type: "expense",
          amount: "300.00",
          currency: "TWD",
          description: `E2E merge dinner ${suffix}`,
          createdBy: web.id,
        })
        .returning();
      await db
        .insert(schema.expensePayers)
        .values({ expenseId: expense.id, payerId: tg.id, amount: "300.00" });
      await db.insert(schema.expenseSplits).values([
        { expenseId: expense.id, debtorId: web.id, amount: "150.00" },
        { expenseId: expense.id, debtorId: tg.id, amount: "150.00" },
      ]);

      const sessionToken = randomBytes(32).toString("hex");
      await db.insert(schema.sessions).values({
        id: sessionToken,
        userId: web.id,
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      });
      const ticket = randomBytes(32).toString("base64url");
      const foreignTicket = randomBytes(32).toString("base64url");
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
      await db.insert(schema.accountMergeTickets).values([
        { id: ticket, userId: web.id, otherUserId: tg.id, provider: "telegram", expiresAt },
        { id: foreignTicket, userId: tg.id, otherUserId: web.id, provider: "google", expiresAt },
      ]);

      await use({
        webUserId: web.id,
        webName,
        tgUserId: tg.id,
        tgName,
        sharedGroupId: shared.id,
        sharedGroupTitle: shared.title,
        expenseId: expense.id,
        webGroupTitle: webGroup.title,
        tgGroupTitle: tgGroup.title,
        sessionToken,
        ticket,
        foreignTicket,
      });
    } finally {
      // Groups first: expenses (and their created_by) go with them, so the users can follow.
      if (groupIds.length) {
        await deleteGroups(db, groupIds);
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
