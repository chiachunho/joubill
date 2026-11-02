import { and, eq, gte, lte, sql } from "drizzle-orm";

import { db } from "@/db";
import { expenses, groups, userBeancountConfigs } from "@/db/schema";

import {
  DEFAULT_CASH_ACCOUNT,
  DEFAULT_EXPENSES_ACCOUNT,
  groupToBeancount,
  recordPostings,
  resolveBeancountAccounts,
  type BeancountExportRange,
  type BeancountRecord,
} from "./beancount";
import type { BeancountRangeQuery } from "./beancount-range";
import { exportFilename } from "./csv";
import { loadGroupRecords, type LoadedRecord } from "./export";

/** The caller's saved row for the group (or null) and the group itself. */
export async function loadBeancountSettings(userId: number, groupId: number) {
  const [[group], [row]] = await Promise.all([
    db.select({ id: groups.id, title: groups.title }).from(groups).where(eq(groups.id, groupId)),
    db
      .select()
      .from(userBeancountConfigs)
      .where(
        and(eq(userBeancountConfigs.userId, userId), eq(userBeancountConfigs.groupId, groupId)),
      ),
  ]);
  if (!group) return null;
  return {
    group,
    accounts: resolveBeancountAccounts(row ?? null, group),
    lastExportedAt: row?.lastExportedAt ?? null,
  };
}

/**
 * Records created after `since` are compared at millisecond precision: `since` went
 * through a JS `Date`, which drops Postgres's microseconds, and comparing the raw
 * column would re-export the very record that set the watermark.
 */
function rangeWhere(range: BeancountExportRange) {
  if (range.kind === "custom") {
    return and(gte(expenses.spentAt, range.from), lte(expenses.spentAt, range.to));
  }
  if (range.kind === "new" && range.since) {
    return sql`date_trunc('milliseconds', ${expenses.createdAt}) > ${range.since.toISOString()}::timestamptz`;
  }
  return undefined;
}

function toBeancountRecord(r: LoadedRecord): BeancountRecord {
  return {
    id: r.id,
    type: r.type,
    amount: r.amount,
    currency: r.currency,
    description: r.description,
    spentAt: r.spentAt.toISOString(),
    payers: r.payers,
    splits: r.splits,
  };
}

/** Only 全部 and 上次匯出後 move the watermark; a custom range is a one-off look back. */
function watermarkOf(range: BeancountExportRange, records: LoadedRecord[]): Date | null {
  if (range.kind === "custom" || records.length === 0) return null;
  // A loop, not `Math.max(...)`: spreading a big group's records overflows the call stack.
  let newest = records[0].createdAt.getTime();
  for (const r of records) newest = Math.max(newest, r.createdAt.getTime());
  return new Date(newest);
}

type Settings = NonNullable<Awaited<ReturnType<typeof loadBeancountSettings>>>;

function resolveRange(query: BeancountRangeQuery, settings: Settings): BeancountExportRange {
  return query.kind === "new" ? { kind: "new", since: settings.lastExportedAt } : query;
}

/** How many records the export would hold, without resolving any rate. For the page. */
export async function summariseBeancountExport(
  userId: number,
  groupId: number,
  query: BeancountRangeQuery,
) {
  const settings = await loadBeancountSettings(userId, groupId);
  if (!settings) return null;
  const range = resolveRange(query, settings);
  const loaded = await loadGroupRecords(groupId, { where: rangeWhere(range), rates: false });
  if (!loaded) return null;
  const included = loaded.records.filter(
    (r) => recordPostings(toBeancountRecord(r), userId, settings.accounts) !== null,
  ).length;
  return {
    included,
    skipped: loaded.records.length - included,
    lastExportedAt: settings.lastExportedAt?.toISOString() ?? null,
  };
}

export async function buildBeancountExport(
  userId: number,
  groupId: number,
  query: BeancountRangeQuery,
  now: Date = new Date(),
): Promise<{
  filename: string;
  text: string;
  included: number;
  watermark: Date | null;
  /** The event account the file posted to, pinned by {@link saveBeancountWatermark}. */
  eventAccount: string;
} | null> {
  const settings = await loadBeancountSettings(userId, groupId);
  if (!settings) return null;
  const range = resolveRange(query, settings);
  const loaded = await loadGroupRecords(groupId, { where: rangeWhere(range) });
  if (!loaded) return null;
  const { group, records, name } = loaded;

  const { text, included } = groupToBeancount({
    groupTitle: group.title,
    defaultCurrency: group.defaultCurrency,
    userId,
    accounts: settings.accounts,
    range,
    now,
    records: records.map((r) => ({
      record: toBeancountRecord(r),
      rate: r.rate,
      // A settlement has no description of its own; name the two people instead.
      narration:
        r.type === "settlement" && !r.description
          ? `還款 ${name(r.payers[0]?.userId ?? 0)} → ${name(r.splits[0]?.userId ?? 0)}`
          : undefined,
    })),
  });

  return {
    filename: exportFilename(group.title, now, "beancount"),
    text,
    included,
    watermark: watermarkOf(range, records),
    eventAccount: settings.accounts.event,
  };
}

/**
 * Remember where this export stopped, once it has been handed over. `greatest` keeps
 * the watermark from moving backwards (Postgres's `greatest` ignores the NULL of a
 * first export). A user who never saved accounts gets a row with the defaults.
 *
 * An unsaved event account is pinned to the one this file used: the default follows
 * the group title, which the bot refreshes on every update, so after a rename the
 * next 上次匯出後 file would post to an account its ledger never opened.
 */
export async function saveBeancountWatermark(
  userId: number,
  groupId: number,
  watermark: Date,
  eventAccount: string,
) {
  await db
    .insert(userBeancountConfigs)
    .values({
      userId,
      groupId,
      expensesAccount: DEFAULT_EXPENSES_ACCOUNT,
      cashAccount: DEFAULT_CASH_ACCOUNT,
      eventAccount,
      lastExportedAt: watermark,
    })
    .onConflictDoUpdate({
      target: [userBeancountConfigs.userId, userBeancountConfigs.groupId],
      set: {
        eventAccount: sql`coalesce(${userBeancountConfigs.eventAccount}, ${eventAccount})`,
        lastExportedAt: sql`greatest(${userBeancountConfigs.lastExportedAt}, ${watermark.toISOString()}::timestamptz)`,
      },
    });
}
