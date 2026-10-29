import { sql } from "drizzle-orm";

import type { db } from "@/db";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Arbitrary namespace so this lock can't collide with other advisory-lock users.
const NAMESPACE = 71;

/**
 * Serialise "check the name is free, then write it" per group. Names are unique within
 * a group but live on `users`, joined through `group_members`, so no single index can
 * enforce it; without this, two concurrent adds/renames both pass the check. Held until
 * the surrounding transaction ends.
 */
export async function lockGroupMemberNames(tx: Tx, groupId: number): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(${NAMESPACE}, ${groupId})`);
}
