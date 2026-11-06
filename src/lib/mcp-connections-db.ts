import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { mcpConnections, groupMembers } from "@/db/schema";
import { BadRequestError } from "@/lib/auth/errors";

/** The columns a client may see: everything but the token hash. */
export const publicConnectionColumns = {
  id: mcpConnections.id,
  kind: mcpConnections.kind,
  name: mcpConnections.name,
  tokenPrefix: mcpConnections.tokenPrefix,
  access: mcpConnections.access,
  allGroups: mcpConnections.allGroups,
  groupIds: mcpConnections.groupIds,
  lastUsedAt: mcpConnections.lastUsedAt,
  expiresAt: mcpConnections.expiresAt,
  revokedAt: mcpConnections.revokedAt,
  createdAt: mcpConnections.createdAt,
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
