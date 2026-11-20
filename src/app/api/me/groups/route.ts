import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { groupMembers, groups } from "@/db/schema";
import { getAuth } from "@/lib/auth";
import { withAuth } from "@/lib/auth/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * When anything in a group's ledger last changed, by anyone: the newest record write in the
 * audit log (a delete counts too); only when the log has none, the newest record row (records
 * written before the log existed); else when the group was made. `coalesce`, not `greatest`:
 * `expenses.updated_at` also moves on writes the log files as group events (a rate lock pins
 * every affected record), which must not count as an update. The audit subquery is an index
 * seek (`record_audit_group_idx`); the `expenses` one only runs for groups with no log rows.
 */
const lastActivityAt = sql<string | Date>`coalesce(
  (select max(a.created_at) from record_audit_log a
    where a.group_id = ${groups.id} and a.record_type in ('expense', 'settlement')),
  (select max(e.updated_at) from expenses e where e.group_id = ${groups.id}),
  ${groups.createdAt}
)`;

export const GET = withAuth(async (req: Request) => {
  const auth = await getAuth(req);

  const rows = await db
    .select({
      id: groups.id,
      title: groups.title,
      defaultCurrency: groups.defaultCurrency,
      lastActivityAt,
    })
    .from(groups)
    .innerJoin(groupMembers, eq(groupMembers.groupId, groups.id))
    .where(eq(groupMembers.userId, auth.user.id));

  return NextResponse.json({
    userId: auth.user.id,
    groups: rows.map((r) => ({ ...r, lastActivityAt: new Date(r.lastActivityAt).toISOString() })),
    activeGroupId: auth.groupFromParam?.id ?? null,
    activeExpenseId: auth.expenseFromParam ?? null,
    activeSettlementId: auth.settlementFromParam ?? null,
    activeInviteCode: auth.inviteFromParam ?? null,
  });
});
