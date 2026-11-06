import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { agentConnections, groupMembers } from "@/db/schema";
import { BadRequestError } from "@/lib/auth/errors";

/** The columns a client may see: everything but the token hash. */
export const publicConnectionColumns = {
  id: agentConnections.id,
  kind: agentConnections.kind,
  name: agentConnections.name,
  tokenPrefix: agentConnections.tokenPrefix,
  access: agentConnections.access,
  allGroups: agentConnections.allGroups,
  groupIds: agentConnections.groupIds,
  lastUsedAt: agentConnections.lastUsedAt,
  expiresAt: agentConnections.expiresAt,
  revokedAt: agentConnections.revokedAt,
  createdAt: agentConnections.createdAt,
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
