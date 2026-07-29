import { labelUser } from "@/lib/label";
import { fmtGrouped } from "@/lib/money";
import { type NoticeLeg, type NoticeRecord } from "@/lib/record-notice";

/**
 * What the audit log stores and how a change is described.
 *
 * Pure — no DB, no network — so both front ends and the API render a change the
 * same way and the whole thing is unit-testable. The DB side lives in
 * `src/lib/record-mutation.ts`.
 */

export type AuditAction = "created" | "updated" | "deleted" | "rate_locked";
export type AuditSource = "bot" | "app";

/**
 * The stored before/after shape.
 *
 * Deliberately `NoticeRecord` plus a few columns rather than a new type: that
 * shape already *is* this app's canonical "what this record is" summary — it is
 * what the group-chat message renders from — so the log can't drift into
 * describing records differently from every other surface. The extra fields are
 * the ones a reader of the log needs and a chat message doesn't.
 *
 * Names are captured as they were at the time. That is the point of a log: it
 * says what the record looked like then, not what it would look like now.
 */
export type RecordSnapshot = NoticeRecord & {
  /** ISO string — JSONB has no date type, and this is read back as JSON. */
  spentAt: string;
  fxRate: number | null;
  fxQuote: string | null;
  /** How many receipt photos were attached. */
  receipts: number;
};

/**
 * A group-level rate lock, logged once instead of once per rewritten row.
 *
 * `expenseIds` / `settlementIds` are what make it visible from a single
 * record's history: without them a record's timeline would show an
 * unexplained jump in its converted amount, with nothing in the log to
 * account for it. See `rateLockTouches`.
 */
export type RateLockPayload = {
  kind: "rateLock";
  base: string;
  quote: string;
  /** NULL when the group rate was deleted rather than changed. */
  rate: number | null;
  expenseIds: number[];
  settlementIds: number[];
};

export function isRateLockPayload(value: unknown): value is RateLockPayload {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { kind?: unknown }).kind === "rateLock"
  );
}

/** Whether a rate lock rewrote this particular record. */
export function rateLockTouches(payload: RateLockPayload, recordId: number): boolean {
  return payload.expenseIds.includes(recordId) || payload.settlementIds.includes(recordId);
}

/* ── diffing ──────────────────────────────────────────────────────────── */

export type ChangedField = {
  key: "amount" | "currency" | "description" | "spentAt" | "payers" | "splits" | "fx" | "receipts";
  /** Traditional-Chinese label, shared by both front ends so they can't drift. */
  label: string;
  before: string;
  after: string;
  /** Extra context when before/after alone is too coarse, e.g. "移除 張大文". */
  detail?: string;
};

const NONE = "（無）";

function legNames(legs: NoticeLeg[]): string[] {
  return legs.map((l) => labelUser(l.user));
}

function legIds(legs: NoticeLeg[]): number[] {
  return legs.map((l) => l.user.userId);
}

/** "移除 A、B" / "新增 C" / both — or undefined when the same people are listed. */
function membershipDetail(before: NoticeLeg[], after: NoticeLeg[]): string | undefined {
  const beforeIds = new Set(legIds(before));
  const afterIds = new Set(legIds(after));

  const removed = before.filter((l) => !afterIds.has(l.user.userId));
  const added = after.filter((l) => !beforeIds.has(l.user.userId));
  if (removed.length === 0 && added.length === 0) return undefined;

  const parts: string[] = [];
  if (removed.length > 0) parts.push(`移除 ${legNames(removed).join("、")}`);
  if (added.length > 0) parts.push(`新增 ${legNames(added).join("、")}`);
  return parts.join(" · ");
}

/** True when the same people owe/paid the same amounts, in any order. */
function legsEqual(a: NoticeLeg[], b: NoticeLeg[]): boolean {
  if (a.length !== b.length) return false;
  const key = (l: NoticeLeg) => `${l.user.userId}:${l.amount}`;
  const sorted = (legs: NoticeLeg[]) => legs.map(key).sort();
  return sorted(a).every((k, i) => k === sorted(b)[i]);
}

function dateLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

function fxLabel(rate: number | null, quote: string | null): string {
  return rate != null && quote != null ? `${rate} ${quote}` : "自動";
}

/**
 * What changed between two snapshots, in display order.
 *
 * Amount and currency stay separate rows on purpose — collapsing them into one
 * "1,200 TWD → 1,200 JPY" line reads as if the number changed when only the
 * currency did. Each row states exactly one fact.
 *
 * An empty result means nothing a reader would care about moved, and the caller
 * should not write a log row at all: a PATCH that rewrites identical payers and
 * splits is not an edit anyone needs to see.
 */
export function diffRecords(before: RecordSnapshot, after: RecordSnapshot): ChangedField[] {
  const out: ChangedField[] = [];

  if (before.amount !== after.amount) {
    out.push({
      key: "amount",
      label: "金額",
      before: fmtGrouped(before.amount),
      after: fmtGrouped(after.amount),
    });
  }

  if (before.currency !== after.currency) {
    out.push({
      key: "currency",
      label: "幣別",
      before: before.currency,
      after: after.currency,
    });
  }

  if ((before.description ?? "") !== (after.description ?? "")) {
    out.push({
      key: "description",
      label: "說明",
      before: before.description || NONE,
      after: after.description || NONE,
    });
  }

  if (dateLabel(before.spentAt) !== dateLabel(after.spentAt)) {
    out.push({
      key: "spentAt",
      label: "日期",
      before: dateLabel(before.spentAt),
      after: dateLabel(after.spentAt),
    });
  }

  if (!legsEqual(before.payers, after.payers)) {
    out.push({
      key: "payers",
      label: "付款人",
      before: legNames(before.payers).join("、") || NONE,
      after: legNames(after.payers).join("、") || NONE,
    });
  }

  if (!legsEqual(before.splits, after.splits)) {
    const detail = membershipDetail(before.splits, after.splits);
    out.push({
      key: "splits",
      label: "分帳",
      before: `${before.splits.length} 人`,
      after: `${after.splits.length} 人`,
      ...(detail ? { detail } : {}),
    });
  }

  if (before.fxRate !== after.fxRate || before.fxQuote !== after.fxQuote) {
    out.push({
      key: "fx",
      label: "匯率",
      before: fxLabel(before.fxRate, before.fxQuote),
      after: fxLabel(after.fxRate, after.fxQuote),
    });
  }

  if (before.receipts !== after.receipts) {
    out.push({
      key: "receipts",
      label: "收據",
      before: `${before.receipts} 張`,
      after: `${after.receipts} 張`,
    });
  }

  return out;
}

/**
 * One-line summary of a record, for the rows that have no before/after to show:
 * "created" lists what was entered, "deleted" what went.
 */
export function summariseRecord(snapshot: RecordSnapshot): string {
  const money = `${fmtGrouped(snapshot.amount)} ${snapshot.currency}`;
  if (snapshot.type === "settlement") {
    const from = snapshot.payers[0];
    const to = snapshot.splits[0];
    if (!from || !to) return money;
    return `${money} · ${labelUser(from.user)} → ${labelUser(to.user)}`;
  }
  return `${money} · ${snapshot.splits.length} 人分帳`;
}
