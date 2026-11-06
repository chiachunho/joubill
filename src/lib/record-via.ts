import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { appConnections, recordAuditLog } from "@/db/schema";

/**
 * Which AI assistant entered a record (issue #150), read from the audit log rather than a
 * column on `expenses`: the `created` row already says who wrote it and from which
 * connection, so a second copy would be one more thing to keep equal without an error.
 * Records entered before the feature, or by a person, have no entry in the map.
 *
 * The name comes from a join. A connection is revoked, never deleted, so its name survives
 * (the audit column is `ON DELETE SET NULL` only for the account-deletion cascade).
 */
type Executor = Pick<typeof db, "select">;

export async function loadCreatedVia(
  recordIds: number[],
  exec: Executor = db,
): Promise<Map<number, string>> {
  if (recordIds.length === 0) return new Map();
  const rows = await exec
    .select({ recordId: recordAuditLog.recordId, name: appConnections.name })
    .from(recordAuditLog)
    .innerJoin(appConnections, eq(appConnections.id, recordAuditLog.appConnectionId))
    .where(
      and(
        inArray(recordAuditLog.recordId, recordIds),
        eq(recordAuditLog.action, "created"),
        eq(recordAuditLog.source, "mcp"),
      ),
    );
  return new Map(rows.flatMap((r) => (r.recordId != null ? [[r.recordId, r.name] as const] : [])));
}

/** The name of the connection behind an agent write, or null for any other actor. */
export async function connectionName(
  connectionId: number | null | undefined,
  exec: Executor = db,
): Promise<string | null> {
  if (connectionId == null) return null;
  const [row] = await exec
    .select({ name: appConnections.name })
    .from(appConnections)
    .where(eq(appConnections.id, connectionId));
  return row?.name ?? null;
}
