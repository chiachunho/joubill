import { and, desc, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { expenses, groupMembers, groups, type Group } from "@/db/schema";

/**
 * The groups a person belongs to, read for commands typed in a private chat (see
 * `groupPicker.ts`). Kept apart from the picker so its tests can stand these queries in.
 */

/** The groups a person is in, the one with the latest record first. */
export async function memberGroups(userId: number): Promise<Group[]> {
  const latest = sql`max(${expenses.createdAt})`;
  const rows = await db
    .select({ group: groups, latest })
    .from(groupMembers)
    .innerJoin(groups, eq(groups.id, groupMembers.groupId))
    .leftJoin(expenses, eq(expenses.groupId, groups.id))
    .where(eq(groupMembers.userId, userId))
    .groupBy(groups.id)
    .orderBy(sql`${latest} desc nulls last`, desc(groups.id));
  return rows.map((r) => r.group);
}

/** The group a pick button names, if the person pressing it is a member; else null. */
export async function pickedGroup(userId: number, groupId: number): Promise<Group | null> {
  const [row] = await db
    .select({ group: groups })
    .from(groupMembers)
    .innerJoin(groups, eq(groups.id, groupMembers.groupId))
    .where(and(eq(groupMembers.userId, userId), eq(groupMembers.groupId, groupId)));
  return row?.group ?? null;
}
