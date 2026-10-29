import { and, eq, gt, isNull, or } from "drizzle-orm";

import { db } from "@/db";
import { groupInvites, groups, type GroupInvite } from "@/db/schema";
import { generateInviteCode, normalizeInviteCode } from "@/lib/invite";

export { INVITE_NOT_FOUND } from "@/lib/invite";

type Executor = Pick<typeof db, "select" | "insert" | "update">;

/** The live invite row for what a person typed, or null for any reason it's unusable. */
export async function findActiveInvite(
  raw: string,
  ex: Executor = db,
): Promise<(GroupInvite & { groupTitle: string }) | null> {
  const code = normalizeInviteCode(raw);
  if (!code) return null;
  const now = new Date();
  const [row] = await ex
    .select({ invite: groupInvites, groupTitle: groups.title })
    .from(groupInvites)
    .innerJoin(groups, eq(groups.id, groupInvites.groupId))
    .where(
      and(
        eq(groupInvites.code, code),
        isNull(groupInvites.revokedAt),
        or(isNull(groupInvites.expiresAt), gt(groupInvites.expiresAt, now)),
      ),
    );
  return row ? { ...row.invite, groupTitle: row.groupTitle } : null;
}

/** A group's live invite, or null when it has none (e.g. it predates invites). */
export async function currentInvite(groupId: number, ex: Executor = db) {
  const now = new Date();
  const [row] = await ex
    .select()
    .from(groupInvites)
    .where(
      and(
        eq(groupInvites.groupId, groupId),
        isNull(groupInvites.revokedAt),
        or(isNull(groupInvites.expiresAt), gt(groupInvites.expiresAt, now)),
      ),
    );
  return row ?? null;
}

/**
 * Revokes the group's live code (if any) and issues a fresh one, so a group only ever has one
 * valid code. The `groups` row is locked first, which serialises two members resetting (or
 * creating the first code) at once; the partial unique index on `group_invites` is the backstop.
 * `revoked` is how many codes this replaced, 0 for a group's first. Must run in a transaction.
 */
export async function rotateInvite(
  tx: Pick<typeof db, "select" | "insert" | "update">,
  groupId: number,
  userId: number,
): Promise<{ invite: GroupInvite; revoked: number }> {
  await tx.select({ id: groups.id }).from(groups).where(eq(groups.id, groupId)).for("update");

  const revoked = await tx
    .update(groupInvites)
    .set({ revokedAt: new Date() })
    .where(and(eq(groupInvites.groupId, groupId), isNull(groupInvites.revokedAt)))
    .returning({ id: groupInvites.id });

  const [invite] = await tx
    .insert(groupInvites)
    .values({ groupId, code: generateInviteCode(), createdBy: userId })
    .returning();
  return { invite, revoked: revoked.length };
}
