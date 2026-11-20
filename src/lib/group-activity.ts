import { sql } from "drizzle-orm";

import { groups } from "@/db/schema";

/**
 * When anything in a group's ledger last changed, by anyone: the newest record write in the
 * audit log (a delete counts too); only when the log has none, the newest record row (records
 * written before the log existed); else when the group was made. `coalesce`, not `greatest`:
 * `expenses.updated_at` also moves on writes the log files as group events (a rate lock pins
 * every affected record), which must not count as an update. The audit subquery is an index
 * seek (`record_audit_group_idx`); the `expenses` one only runs for groups with no log rows.
 */
export const lastActivityAt = sql<string | Date>`coalesce(
  (select max(a.created_at) from record_audit_log a
    where a.group_id = ${groups.id} and a.record_type in ('expense', 'settlement', 'refund')),
  (select max(e.updated_at) from expenses e where e.group_id = ${groups.id}),
  ${groups.createdAt}
)`;
