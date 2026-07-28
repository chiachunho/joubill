import { type Api } from "grammy";

import { db } from "@/db";
import { recordAuditLog } from "@/db/schema";
import {
  deleterOf,
  loadNoticeRecord,
  markNoticeDeleted,
  rememberNoticeMessage,
  sendRecordNotice,
  updateRecordNotice,
  type LoadedNotice,
} from "@/lib/notify";
import {
  diffRecords,
  type AuditSource,
  type RateLockPayload,
  type RecordSnapshot,
} from "@/lib/record-audit";

/**
 * The single way a record is created, changed or deleted.
 *
 * Every mutation site goes through here, and that is the whole design. The
 * fifteen write points are spread across six API route handlers and seven bot
 * callbacks; a separate `logAudit()` bolted on beside each of them would be
 * forgotten somewhere, and a missing audit row is invisible — exactly the kind
 * of silent drift CLAUDE.md's sharing rule exists to prevent.
 *
 * So logging is fused to the thing every one of those sites *already* cannot
 * skip: keeping the record's group-chat message in sync. Forget to route a
 * mutation through here and the Telegram message stops matching the record,
 * which someone notices the same day. The log can't rot on its own.
 *
 * `actor` is a required argument for the same reason — the compiler asks "who
 * did this?" at every call site, and there is no default that could quietly be
 * wrong.
 *
 * Errors from the chat side are swallowed by `notify.ts`. Errors from the log
 * write are swallowed here: an audit row is worth a lot, but not worth failing
 * a save the user already believes succeeded.
 */

export type Actor = { userId: number; source: AuditSource };

/**
 * Passing `api` asks this layer to send or edit the record's group message —
 * that is every API route handler, none of which has a message of its own.
 *
 * Passing `null` says the caller owns that message and will render it itself.
 * The bot's panel buttons re-render the card in `adjust` / `who` / `shares`
 * mode, which this layer must not flatten back to `default` mid-interaction,
 * and `/add` posts the card it just built. **Only the message handling
 * differs — the log is written either way**, which is the point: there is no
 * call shape that logs nothing.
 */
type MaybeApi = Api | null;

async function writeLog(entry: {
  groupId: number;
  recordId: number | null;
  recordType: string;
  action: string;
  actor: Actor;
  before: RecordSnapshot | null;
  after: RecordSnapshot | RateLockPayload | null;
}): Promise<void> {
  try {
    await db.insert(recordAuditLog).values({
      groupId: entry.groupId,
      recordId: entry.recordId,
      recordType: entry.recordType,
      action: entry.action,
      actorId: entry.actor.userId,
      source: entry.actor.source,
      before: entry.before,
      after: entry.after,
    });
  } catch (err) {
    console.error("[audit] failed to write log entry:", err);
  }
}

/**
 * Logs a freshly created record and puts its message in the group.
 *
 * With `api === null` the caller has already posted the message and only needs
 * it bound to the record — that is `/add`, which builds and sends the card
 * itself so a bot-created expense never gets a duplicate.
 */
export async function logCreated(
  api: MaybeApi,
  recordId: number,
  actor: Actor,
  opts: { messageId?: number } = {},
): Promise<void> {
  const loaded = await loadNoticeRecord(recordId);
  if (loaded) {
    await writeLog({
      groupId: loaded.groupId,
      recordId,
      recordType: loaded.record.type,
      action: "created",
      actor,
      before: null,
      after: loaded.record,
    });
  }

  if (api) {
    await sendRecordNotice(api, recordId);
    return;
  }
  if (opts.messageId != null) await rememberNoticeMessage(recordId, opts.messageId);
}

/**
 * Runs `mutate`, logs what it actually changed, and refreshes the group message.
 *
 * The before/after pair is loaded around the mutation, so nothing has to
 * describe its own edit — a caller that rewrites five columns and a caller that
 * flips one produce the same kind of row. When the diff is empty no row is
 * written: the expense PATCH replaces payers and splits wholesale on every
 * save, so an identical re-save is not an edit anyone needs to read about.
 *
 * Returns whatever `mutate` returns.
 */
export async function logUpdated<T>(
  api: MaybeApi,
  recordId: number,
  actor: Actor,
  mutate: () => Promise<T>,
): Promise<T> {
  const before = await loadNoticeRecord(recordId);
  const result = await mutate();
  const after = await loadNoticeRecord(recordId);

  if (before && after && diffRecords(before.record, after.record).length > 0) {
    await writeLog({
      groupId: after.groupId,
      recordId,
      recordType: after.record.type,
      action: "updated",
      actor,
      before: before.record,
      after: after.record,
    });
  }

  if (api) await updateRecordNotice(api, recordId);
  return result;
}

/**
 * Runs `del`, logs what went, and leaves the tombstone message behind.
 *
 * The snapshot is taken before the row disappears — which is the same
 * requirement the group message already had, and the reason these two
 * responsibilities belong in one place rather than two.
 */
export async function logDeleted(
  api: MaybeApi,
  recordId: number,
  actor: Actor,
  deleter: Parameters<typeof deleterOf>[0],
  del: () => Promise<void>,
): Promise<LoadedNotice | null> {
  const before = await loadNoticeRecord(recordId);
  await del();

  if (before) {
    await writeLog({
      groupId: before.groupId,
      recordId,
      recordType: before.record.type,
      action: "deleted",
      actor,
      before: before.record,
      after: null,
    });
  }

  if (api) await markNoticeDeleted(api, before, deleterOf(deleter));
  return before;
}

/**
 * Logs a group rate lock: one row for a change that rewrote many records.
 *
 * Deliberately not one `updated` row per touched record — the user performed a
 * single group-level action, and fanning it out would bury a day's real edits
 * under fifty identical lines. The affected ids ride along in the payload so a
 * single record's history can still explain why its converted amount moved.
 */
export async function logRateLock(
  groupId: number,
  actor: Actor,
  payload: RateLockPayload,
): Promise<void> {
  if (payload.expenseIds.length === 0 && payload.settlementIds.length === 0) return;
  await writeLog({
    groupId,
    recordId: null,
    recordType: "group",
    action: "rate_locked",
    actor,
    before: null,
    after: payload,
  });
}
