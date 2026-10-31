import { randomBytes } from "node:crypto";

import type { Pool } from "@neondatabase/serverless";
import { expect, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import { and, asc, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-serverless";

import * as schema from "../src/db/schema";
import { setSessionCookie } from "./fixtures";

/**
 * A browser context signed in as `userId` (usually the seeded outsider). The session row goes
 * with the user in the fixture's teardown, since sessions cascade.
 */
export async function signedInPage(
  browser: Browser,
  baseURL: string | undefined,
  dbPool: Pool,
  userId: number,
) {
  const token = randomBytes(24).toString("hex");
  await drizzle(dbPool, { schema })
    .insert(schema.sessions)
    .values({ id: token, userId, expiresAt: new Date(Date.now() + 3_600_000) });
  const context = await browser.newContext({ baseURL });
  await setSessionCookie(context, baseURL, token);
  return { context, page: await context.newPage() };
}

/** Adds a member without an account and returns their id. */
export async function mkPlaceholder(
  request: APIRequestContext,
  groupId: number,
  firstName: string,
): Promise<number> {
  const res = await request.post(`/api/groups/${groupId}/members/placeholder`, {
    data: { firstName },
  });
  expect(res.status()).toBe(201);
  return ((await res.json()) as { member: { id: number } }).member.id;
}

export type ExpenseBody = {
  amount: number;
  shareType: "equal" | "exact" | "percent" | "shares" | "adjustment";
  payers: { payerId: number; amount: number }[];
  splits: { debtorId: number; amount: number; splitValue?: number | null }[];
};

function expenseData(body: ExpenseBody) {
  return {
    currency: "TWD",
    description: `E2E merge ${body.shareType} ${Date.now()}`,
    spentAt: new Date().toISOString(),
    ...body,
  };
}

/** Records an expense through the API (so the same validation as the form applies). */
export async function addExpense(
  request: APIRequestContext,
  groupId: number,
  body: ExpenseBody,
): Promise<number> {
  const res = await request.post(`/api/groups/${groupId}/expenses`, { data: expenseData(body) });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { id: number }).id;
}

/** PATCH replaces payers and splits wholesale, the way the edit form saves. */
export function editExpense(
  request: APIRequestContext,
  groupId: number,
  expenseId: number,
  body: ExpenseBody,
) {
  return request.patch(`/api/groups/${groupId}/expenses/${expenseId}`, {
    data: expenseData(body),
  });
}

export async function addSettlement(
  request: APIRequestContext,
  groupId: number,
  fromUserId: number,
  toUserId: number,
  amount: number,
): Promise<number> {
  const res = await request.post(`/api/groups/${groupId}/settlements`, {
    data: { fromUserId, toUserId, amount, currency: "TWD" },
  });
  expect(res.ok(), await res.text()).toBe(true);
  return ((await res.json()) as { id: number }).id;
}

/** Each member's net position (paid − owed) in the group's currency, as `/balance` reports it. */
export async function balances(
  request: APIRequestContext,
  groupId: number,
): Promise<Map<number, number>> {
  const res = await request.get(`/api/groups/${groupId}/balance`);
  expect(res.ok()).toBe(true);
  const { balances } = (await res.json()) as { balances: { userId: number; amount: number }[] };
  return new Map(balances.map((b) => [b.userId, b.amount]));
}

/**
 * What the balances must read after `fromId` is merged into `toId`: the two nets add up and
 * nobody else moves. Stronger than "the total is unchanged", which holds for any ledger.
 */
export function mergedBalances(before: Map<number, number>, fromId: number, toId: number) {
  const after = new Map(before);
  const moved = after.get(fromId) ?? 0;
  after.delete(fromId);
  after.set(toId, round2((after.get(toId) ?? 0) + moved));
  // `/balance` omits members whose net is zero.
  for (const [id, v] of after) if (Math.abs(v) < 0.005) after.delete(id);
  return after;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/** The payer and split rows of one record, straight from the database. */
export async function legs(dbPool: Pool, expenseId: number) {
  const db = drizzle(dbPool, { schema });
  const [payers, splits] = await Promise.all([
    db
      .select()
      .from(schema.expensePayers)
      .where(eq(schema.expensePayers.expenseId, expenseId))
      .orderBy(asc(schema.expensePayers.payerId)),
    db
      .select()
      .from(schema.expenseSplits)
      .where(eq(schema.expenseSplits.expenseId, expenseId))
      .orderBy(asc(schema.expenseSplits.debtorId)),
  ]);
  return {
    payers: payers.map((p) => ({ payerId: p.payerId, amount: Number(p.amount) })),
    splits: splits.map((s) => ({
      debtorId: s.debtorId,
      amount: Number(s.amount),
      shareType: s.shareType,
      splitValue: s.splitValue == null ? null : Number(s.splitValue),
    })),
  };
}

/** Whether any row still names `userId` as a payer or debtor in these records. */
export async function legsNaming(dbPool: Pool, expenseIds: number[], userId: number) {
  const db = drizzle(dbPool, { schema });
  const [payers, splits] = await Promise.all([
    db
      .select({ payerId: schema.expensePayers.payerId })
      .from(schema.expensePayers)
      .where(inArray(schema.expensePayers.expenseId, expenseIds)),
    db
      .select({ debtorId: schema.expenseSplits.debtorId })
      .from(schema.expenseSplits)
      .where(inArray(schema.expenseSplits.expenseId, expenseIds)),
  ]);
  return payers.some((p) => p.payerId === userId) || splits.some((s) => s.debtorId === userId);
}

/** The audit actions logged for a group, or for one of its records when `recordId` is given. */
export async function auditActions(dbPool: Pool, groupId: number, recordId?: number) {
  const rows = await drizzle(dbPool, { schema })
    .select({ action: schema.recordAuditLog.action })
    .from(schema.recordAuditLog)
    .where(
      and(
        eq(schema.recordAuditLog.groupId, groupId),
        recordId === undefined ? undefined : eq(schema.recordAuditLog.recordId, recordId),
      ),
    );
  return rows.map((r) => r.action);
}

/**
 * 新增成員, from 群組設定's member list or the one-person group card (whichever the page
 * shows), then one of the two ways to add someone.
 */
export async function openAddMember(page: Page, option: "新增沒有帳號的成員" | "用邀請碼邀請") {
  await page.getByRole("button", { name: "新增成員", exact: true }).click();
  await page.getByRole("button", { name: new RegExp(option) }).click();
}
