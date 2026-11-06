import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { appConnections, groupMembers } from "@/db/schema";
import { BadRequestError } from "@/lib/auth/errors";

/** The columns a client may see: everything but the token hash. */
export const publicConnectionColumns = {
  id: appConnections.id,
  kind: appConnections.kind,
  name: appConnections.name,
  tokenPrefix: appConnections.tokenPrefix,
  access: appConnections.access,
  allGroups: appConnections.allGroups,
  groupIds: appConnections.groupIds,
  lastUsedAt: appConnections.lastUsedAt,
  expiresAt: appConnections.expiresAt,
  revokedAt: appConnections.revokedAt,
  createdAt: appConnections.createdAt,
};

/** Throws unless `userId` belongs to every one of `groupIds` (a scope can't name a stranger's group). */
export async function assertMemberOfAll(userId: number, groupIds: number[]): Promise<void> {
  if (groupIds.length === 0) return;
  const mine = await db
    .select({ groupId: groupMembers.groupId })
    .from(groupMembers)
    .where(and(eq(groupMembers.userId, userId), inArray(groupMembers.groupId, groupIds)));
  if (mine.length !== groupIds.length) throw new BadRequestError("not a member of every group");
}
