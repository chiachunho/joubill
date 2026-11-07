import { and, desc, eq, inArray, lt, ne, or, sql } from "drizzle-orm";

import { db } from "@/db";
import type { ActivitySource } from "@/lib/activity-source";
import { mcpConnections, recordAuditLog, users } from "@/db/schema";
import {
  diffRecords,
  isGroupEventPayload,
  isRateLockPayload,
  summariseRecord,
  type AuditAction,
  type ChangedField,
  type RecordSnapshot,
} from "@/lib/record-audit";

/**
 * Reading the audit log.
 *
 * The before/after diffing happens here rather than in the pages, so the
 * `/mini` and `/app` copies of the activity view render from identical data —
 * a change described one way on one front end and another way on the other is
 * exactly the silent drift the near-duplicate rule warns about.
 */

export type ActivityActor = {
  userId: number;
  displayName: string | null;
  firstName: string;
  lastName: string | null;
  username: string | null;
};

export type ActivityEntry = {
  id: number;
  action: AuditAction;
  /** ISO timestamp. */
  at: string;
  actor: ActivityActor | null;
  /** The AI assistant the actor worked through (issue #150), or null for a person's own change. */
  via: string | null;
  /** NULL for group-level events. */
  recordId: number | null;
  recordType: string;
  /** The record's description at the time, so a feed row can name it. */
  recordLabel: string | null;
  /** 'created' and 'deleted': what was entered, or what went. */
  summary?: string;
  /** 'updated': the fields that actually moved. */
  changes?: ChangedField[];
  /** 'rate_locked': what was agreed, and how much it touched. */
  rateLock?: {
    base: string;
    quote: string;
    rate: number | null;
    expenses: number;
    settlements: number;
  };
  /** 'member_joined': who made the invite the member used. 'chat_linked' / 'chat_unlinked': the chat it was bound to, or detached from. */
  groupEvent?: {
    inviterName?: string;
    chatTitle?: string;
    claimedName?: string;
    claimedCount?: number;
    claimerName?: string;
    /** 'timezone_changed': the IANA names before and after. */
    timezoneFrom?: string;
    timezoneTo?: string;
  };
};

type Row = {
  id: number;
  action: string;
  createdAt: Date;
  recordId: number | null;
  recordType: string;
  before: unknown;
  after: unknown;
  actorId: number | null;
  actorDisplayName: string | null;
  actorFirstName: string | null;
  actorLastName: string | null;
  actorUsername: string | null;
  viaName: string | null;
};

const SELECT = {
  id: recordAuditLog.id,
  action: recordAuditLog.action,
  createdAt: recordAuditLog.createdAt,
  recordId: recordAuditLog.recordId,
  recordType: recordAuditLog.recordType,
  before: recordAuditLog.before,
  after: recordAuditLog.after,
  actorId: users.id,
  actorDisplayName: users.displayName,
  actorFirstName: users.firstName,
  actorLastName: users.lastName,
  actorUsername: users.username,
  viaName: mcpConnections.name,
};

function asSnapshot(value: unknown): RecordSnapshot | null {
  return value &&
    typeof value === "object" &&
    !isRateLockPayload(value) &&
    !isGroupEventPayload(value)
    ? (value as RecordSnapshot)
    : null;
}

function toEntry(row: Row): ActivityEntry {
  const before = asSnapshot(row.before);
  const after = asSnapshot(row.after);
  const action = row.action as AuditAction;

  const entry: ActivityEntry = {
    id: row.id,
    action,
    at: row.createdAt.toISOString(),
    actor:
      row.actorId != null
        ? {
            userId: row.actorId,
            displayName: row.actorDisplayName,
            firstName: row.actorFirstName!,
            lastName: row.actorLastName,
            username: row.actorUsername,
          }
        : null,
    via: row.viaName,
    recordId: row.recordId,
    recordType: row.recordType,
    recordLabel: after?.description ?? before?.description ?? null,
  };

  if (action === "rate_locked" && isRateLockPayload(row.after)) {
    entry.rateLock = {
      base: row.after.base,
      quote: row.after.quote,
      rate: row.after.rate,
      expenses: row.after.expenseIds.length,
      settlements: row.after.settlementIds.length,
    };
    return entry;
  }

  if (isGroupEventPayload(row.after)) {
    if (row.after.kind === "memberJoined") {
      entry.groupEvent = { inviterName: row.after.inviterName };
    } else if (row.after.kind === "chatLinked" || row.after.kind === "chatUnlinked") {
      entry.groupEvent = { chatTitle: row.after.chatTitle };
    } else if (row.after.kind === "timezoneChanged") {
      entry.groupEvent = { timezoneFrom: row.after.from, timezoneTo: row.after.to };
    } else if (row.after.kind === "memberClaimed") {
      entry.groupEvent = {
        claimedName: row.after.placeholderName,
        claimedCount: row.after.recordIds.length,
        ...(row.actorId !== row.after.claimerId ? { claimerName: row.after.claimerName } : {}),
      };
    } else if (row.after.kind === "accountMerged") {
      entry.groupEvent = {
        claimedName: row.after.absorbedName,
        claimedCount: row.after.recordIds.length,
      };
    }
    return entry;
  }

  if (action === "updated" && before && after) {
    entry.changes = diffRecords(before, after);
    return entry;
  }

  const snapshot = after ?? before;
  if (snapshot) entry.summary = summariseRecord(snapshot);
  return entry;
}

/**
 * "Last changed by X at T" for a record's edit form.
 *
 * Only counts edits: a record nobody has touched since it was entered has
 * `createdBy` to speak for it already, and repeating that as "last modified"
 * would be noise on every untouched row.
 */
export async function loadLastActivity(recordId: number): Promise<ActivityEntry | null> {
  const [row] = await db
    .select(SELECT)
    .from(recordAuditLog)
    .leftJoin(users, eq(users.id, recordAuditLog.actorId))
    .leftJoin(mcpConnections, eq(mcpConnections.id, recordAuditLog.mcpConnectionId))
    .where(and(eq(recordAuditLog.recordId, recordId), eq(recordAuditLog.action, "updated")))
    .orderBy(desc(recordAuditLog.id))
    .limit(1);

  return row ? toEntry(row) : null;
}

/**
 * One record's whole history, newest first.
 *
 * Group-level rate locks are pulled in by id containment. Without this a
 * record's timeline would show its converted amount jumping with nothing in
 * the list to account for it — the lock is logged once for the group, but it
 * genuinely happened to this record too.
 */
export async function loadRecordHistory(
  groupId: number,
  recordId: number,
): Promise<ActivityEntry[]> {
  const rows = await db
    .select(SELECT)
    .from(recordAuditLog)
    .leftJoin(users, eq(users.id, recordAuditLog.actorId))
    .leftJoin(mcpConnections, eq(mcpConnections.id, recordAuditLog.mcpConnectionId))
    .where(
      and(
        eq(recordAuditLog.groupId, groupId),
        or(
          eq(recordAuditLog.recordId, recordId),
          and(
            inArray(recordAuditLog.action, ["member_claimed", "account_merged"]),
            sql`${recordAuditLog.after}->'recordIds' @> ${JSON.stringify(recordId)}::jsonb`,
          ),
          and(
            eq(recordAuditLog.action, "rate_locked"),
            // Two separate fragments joined by drizzle's `or`, which parenthesises
            // them. A single fragment containing a raw `OR` would bind looser than
            // the surrounding `AND` and quietly widen the match.
            or(
              sql`${recordAuditLog.after}->'expenseIds' @> ${JSON.stringify(recordId)}::jsonb`,
              sql`${recordAuditLog.after}->'settlementIds' @> ${JSON.stringify(recordId)}::jsonb`,
            ),
          ),
        ),
      ),
    )
    .orderBy(desc(recordAuditLog.id));

  return rows.map(toEntry);
}

export const ACTIVITY_PAGE_SIZE = 30;

/**
 * The group's whole feed, newest first. `cursor` is the last id already seen. `source`
 * narrows it to changes a linked application made, or to everything else; filtering here
 * rather than in the page keeps every page full, since a page of 30 that the filter empties
 * would look like the end of the feed.
 */
export async function loadGroupActivity(
  groupId: number,
  cursor?: number,
  source: ActivitySource = "all",
): Promise<{ entries: ActivityEntry[]; nextCursor: number | null }> {
  const where = and(
    eq(recordAuditLog.groupId, groupId),
    cursor != null ? lt(recordAuditLog.id, cursor) : undefined,
    source === "mcp" ? eq(recordAuditLog.source, "mcp") : undefined,
    source === "manual" ? ne(recordAuditLog.source, "mcp") : undefined,
  );
  const rows = await db
    .select(SELECT)
    .from(recordAuditLog)
    .leftJoin(users, eq(users.id, recordAuditLog.actorId))
    .leftJoin(mcpConnections, eq(mcpConnections.id, recordAuditLog.mcpConnectionId))
    .where(where)
    .orderBy(desc(recordAuditLog.id))
    .limit(ACTIVITY_PAGE_SIZE + 1);

  const page = rows.slice(0, ACTIVITY_PAGE_SIZE);
  return {
    entries: page.map(toEntry),
    nextCursor: rows.length > ACTIVITY_PAGE_SIZE ? page[page.length - 1].id : null,
  };
}
