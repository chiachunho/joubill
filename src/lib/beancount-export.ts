import { and, asc, eq, gte, inArray, isNotNull, lte, sql } from "drizzle-orm";

import { db } from "@/db";
import { expenses, groups, recordAuditLog, userBeancountConfigs } from "@/db/schema";

import {
  beancountDate,
  DEFAULT_CASH_ACCOUNT,
  DEFAULT_EXPENSES_ACCOUNT,
  groupToBeancount,
  recordPostings,
  resolveBeancountAccounts,
  type BeancountExportRange,
  type BeancountRecord,
  type CorrectionGroup,
} from "./beancount";
import {
  planCorrection,
  snapshotToBeancountRecord,
  type CorrectionPlan,
} from "./beancount-corrections";
import type { BeancountRangeQuery } from "./beancount-range";
import { exportFilename } from "./csv";
import { todayIn } from "./day";
import { loadGroupRecords, type LoadedRecord } from "./export";
import { loadGroupRateContext, resolveRate } from "./fx";
import { labelUser } from "./label";
import type { RecordSnapshot } from "./record-audit";

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
    correctionsSince: row?.correctionsSince ?? null,
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
    spentAt: r.spentAt,
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

type PlannedCorrection = {
  id: number;
  /** The record as the last export wrote it. */
  snapshot: RecordSnapshot;
  /** The record now; null once deleted. */
  live: LoadedRecord | null;
  plan: CorrectionPlan;
};

function isSnapshot(value: unknown): value is RecordSnapshot {
  const v = value as Partial<RecordSnapshot> | null;
  return (
    typeof v === "object" &&
    v !== null &&
    Array.isArray(v.payers) &&
    Array.isArray(v.splits) &&
    typeof v.spentAt === "string"
  );
}

/**
 * The records an earlier export already covered and a member has since edited or
 * deleted, with what to write about each (issue #124). Only 上次匯出後 has any, and
 * only once the user's last file recorded when it was built (`correctionsSince`).
 *
 * The exported version is the `before` of the first audit row after that moment,
 * whatever came later, so a record edited five times yields one correction. A record
 * created after the last export is not here: the ordinary range already carries it.
 */
async function planGroupCorrections(
  userId: number,
  groupId: number,
  settings: Settings,
  range: BeancountExportRange,
  until: Date,
  rates: boolean,
): Promise<PlannedCorrection[]> {
  const mark = settings.correctionsSince;
  if (range.kind !== "new" || !range.since || !mark) return [];
  const since = range.since;

  const audit = await db
    .select({
      recordId: recordAuditLog.recordId,
      action: recordAuditLog.action,
      before: recordAuditLog.before,
    })
    .from(recordAuditLog)
    .where(
      and(
        eq(recordAuditLog.groupId, groupId),
        inArray(recordAuditLog.recordType, ["expense", "settlement"]),
        inArray(recordAuditLog.action, ["updated", "deleted"]),
        isNotNull(recordAuditLog.recordId),
        sql`date_trunc('milliseconds', ${recordAuditLog.createdAt}) > ${mark.toISOString()}::timestamptz`,
        sql`date_trunc('milliseconds', ${recordAuditLog.createdAt}) <= ${until.toISOString()}::timestamptz`,
      ),
    )
    .orderBy(asc(recordAuditLog.createdAt), asc(recordAuditLog.id));

  const snapshots = new Map<number, RecordSnapshot>();
  const deleted = new Set<number>();
  for (const row of audit) {
    if (row.recordId === null) continue;
    if (!snapshots.has(row.recordId) && isSnapshot(row.before)) {
      snapshots.set(row.recordId, row.before);
    }
    if (row.action === "deleted") deleted.add(row.recordId);
  }
  const ids = [...snapshots.keys()];
  if (ids.length === 0) return [];

  const loaded = await loadGroupRecords(groupId, { where: inArray(expenses.id, ids), rates });
  if (!loaded) return [];
  const live = new Map(loaded.records.map((r) => [r.id, r]));

  // A deleted record has no row left to date: its creation is in the log. One that
  // predates the log has no such row and is taken to have been exported.
  const createdAt = new Map<number, number>();
  if (deleted.size > 0) {
    const created = await db
      .select({ recordId: recordAuditLog.recordId, createdAt: recordAuditLog.createdAt })
      .from(recordAuditLog)
      .where(
        and(
          eq(recordAuditLog.groupId, groupId),
          eq(recordAuditLog.action, "created"),
          inArray(recordAuditLog.recordId, [...deleted]),
        ),
      );
    for (const c of created) {
      if (c.recordId !== null) createdAt.set(c.recordId, c.createdAt.getTime());
    }
  }

  const planned: PlannedCorrection[] = [];
  for (const id of ids) {
    const snapshot = snapshots.get(id)!;
    const record = live.get(id) ?? null;
    const born = record ? record.createdAt.getTime() : (createdAt.get(id) ?? 0);
    // Created after the last file was built: never exported, and the ordinary range
    // (created after the record watermark) already carries it.
    if (born > mark.getTime()) continue;
    if (record && record.createdAt.getTime() > since.getTime()) continue;
    if (!record && !deleted.has(id)) continue;
    const plan = planCorrection(
      snapshotToBeancountRecord(id, snapshot),
      record ? toBeancountRecord(record) : null,
      userId,
      settings.accounts,
    );
    if (plan.kind !== "none") planned.push({ id, snapshot, live: record, plan });
  }
  return planned.sort(
    (a, b) =>
      beancountDate(a.snapshot.spentAt).localeCompare(beancountDate(b.snapshot.spentAt)) ||
      a.id - b.id,
  );
}

/** How many records the export would hold, without resolving any rate. For the page. */
export async function summariseBeancountExport(
  userId: number,
  groupId: number,
  query: BeancountRangeQuery,
  now: Date = new Date(),
) {
  const settings = await loadBeancountSettings(userId, groupId);
  if (!settings) return null;
  const range = resolveRange(query, settings);
  const [loaded, fixes] = await Promise.all([
    loadGroupRecords(groupId, { where: rangeWhere(range), rates: false }),
    planGroupCorrections(userId, groupId, settings, range, now, false),
  ]);
  if (!loaded) return null;
  const mine = loaded.records.filter(
    (r) => recordPostings(toBeancountRecord(r), userId, settings.accounts) !== null,
  ).length;
  return {
    included: mine + fixes.filter((f) => f.plan.kind === "new").length,
    corrected: fixes.filter((f) => f.plan.kind === "correction").length,
    skipped: loaded.records.length - mine,
    lastExportedAt: settings.lastExportedAt?.toISOString() ?? null,
  };
}

/** What a settlement is called in the file: it has no description of its own. */
function settlementNarration(from: string, to: string) {
  return `還款 ${from} → ${to}`;
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
  /** Records an earlier export covered that this file corrects. */
  corrected: number;
  watermark: Date | null;
  /** When the file was built, for 全部 / 上次匯出後; null for a custom range. */
  exportedAt: Date | null;
  /** The event account the file posted to, pinned by {@link saveBeancountWatermark}. */
  eventAccount: string;
} | null> {
  const settings = await loadBeancountSettings(userId, groupId);
  if (!settings) return null;
  const range = resolveRange(query, settings);
  const [loaded, fixes, rateCtx] = await Promise.all([
    loadGroupRecords(groupId, { where: rangeWhere(range) }),
    planGroupCorrections(userId, groupId, settings, range, now, true),
    loadGroupRateContext(groupId),
  ]);
  if (!loaded) return null;
  const { group, records, name } = loaded;

  const entries = records.map((r) => ({
    record: toBeancountRecord(r),
    rate: r.rate,
    narration:
      r.type === "settlement" && !r.description
        ? settlementNarration(name(r.payers[0]?.userId ?? 0), name(r.splits[0]?.userId ?? 0))
        : undefined,
    spentAt: r.spentAt,
  }));
  const corrections: CorrectionGroup[] = [];
  for (const f of fixes) {
    if (f.plan.kind === "new" && f.live) {
      const r = f.live;
      entries.push({
        record: f.plan.current,
        rate: r.rate,
        narration: undefined,
        spentAt: r.spentAt,
      });
    } else if (f.plan.kind === "correction") {
      const snap = f.snapshot;
      const { reverse, current, correction } = f.plan;
      const nameOfLeg = (leg?: { user: Parameters<typeof labelUser>[0] }) =>
        leg ? labelUser(leg.user) : "?";
      const old =
        snap.type === "settlement" && !snap.description
          ? settlementNarration(nameOfLeg(snap.payers[0]), nameOfLeg(snap.splits[0]))
          : undefined;
      // The exported rate: the record's own pin if it still applied, else what the
      // group would resolve today. A changed group rate can only move the price note;
      // the entry still cancels in the record's own currency.
      const pinned =
        snap.fxRate != null && snap.fxQuote === group.defaultCurrency ? snap.fxRate : null;
      const reverseRate =
        reverse.currency === group.defaultCurrency
          ? 1
          : (pinned ??
            (await resolveRate(
              { currency: reverse.currency, fxRate: null, fxQuote: null },
              group.defaultCurrency,
              beancountDate(reverse.spentAt),
              rateCtx,
            )));
      corrections.push([
        { record: reverse, rate: reverseRate, narration: old, correction, reverse: true },
        ...(current && f.live
          ? [
              {
                record: current,
                rate: f.live.rate,
                narration:
                  current.type === "settlement" && !current.description
                    ? settlementNarration(
                        name(current.payers[0]?.userId ?? 0),
                        name(current.splits[0]?.userId ?? 0),
                      )
                    : undefined,
                correction,
                reverse: false,
              },
            ]
          : []),
      ]);
    }
  }
  // Records that became yours by an edit sit among the rest, by spending date.
  entries.sort((a, b) => a.spentAt.localeCompare(b.spentAt) || a.record.id - b.record.id);

  const { text, included, corrected } = groupToBeancount({
    groupTitle: group.title,
    defaultCurrency: group.defaultCurrency,
    userId,
    accounts: settings.accounts,
    range,
    now,
    records: entries,
    corrections,
  });

  return {
    filename: exportFilename(group.title, todayIn(group.timezone, now), "beancount"),
    text,
    included,
    corrected,
    watermark: watermarkOf(range, records),
    exportedAt: range.kind === "custom" ? null : now,
    eventAccount: settings.accounts.event,
  };
}

/**
 * Remember where this export stopped, once it has been handed over. `greatest` keeps
 * the watermarks from moving backwards (Postgres's `greatest` ignores the NULL of a
 * first export). A user who never saved accounts gets a row with the defaults.
 *
 * `exportedAt` is when the file was built, which the next file's corrections start
 * from. It moves even when the file held no records (`watermark` null), since edits
 * made after that moment still need correcting.
 *
 * An unsaved event account is pinned to the one this file used: the default follows
 * the group title, which the bot refreshes on every update, so after a rename the
 * next 上次匯出後 file would post to an account its ledger never opened.
 */
export async function saveBeancountWatermark(
  userId: number,
  groupId: number,
  watermark: Date | null,
  eventAccount: string,
  exportedAt: Date,
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
      correctionsSince: exportedAt,
    })
    .onConflictDoUpdate({
      target: [userBeancountConfigs.userId, userBeancountConfigs.groupId],
      set: {
        eventAccount: sql`coalesce(${userBeancountConfigs.eventAccount}, ${eventAccount})`,
        // An export with no records leaves the record watermark where it was.
        ...(watermark
          ? {
              lastExportedAt: sql`greatest(${userBeancountConfigs.lastExportedAt}, ${watermark.toISOString()}::timestamptz)`,
            }
          : {}),
        correctionsSince: sql`greatest(${userBeancountConfigs.correctionsSince}, ${exportedAt.toISOString()}::timestamptz)`,
      },
    });
}
