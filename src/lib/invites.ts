import { and, eq, gt, isNull, or } from "drizzle-orm";

import { db } from "@/db";
import { groupInvites, groups, type GroupInvite } from "@/db/schema";
import { generateInviteCode, normalizeInviteCode } from "@/lib/invite";

/**
 * The one answer for every invite code that can't be used — never issued, revoked
 * or expired. Callers must not tell these apart: a different reply per cause would
 * let someone probe which codes exist. Every route returns this same status + text.
 */
export const INVITE_NOT_FOUND = { status: 404, error: "邀請碼無效或已失效" } as const;

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
 * Revokes the group's live code (if any) and issues a fresh one, so a group only
 * ever has one valid code. A unique-key collision is astronomically unlikely at
 * 50 bits but cheap to retry.
 */
export async function rotateInvite(
  ex: Pick<typeof db, "insert" | "update">,
  groupId: number,
  userId: number,
): Promise<GroupInvite> {
  await ex
    .update(groupInvites)
    .set({ revokedAt: new Date() })
    .where(and(eq(groupInvites.groupId, groupId), isNull(groupInvites.revokedAt)));

  for (let attempt = 0; ; attempt++) {
    try {
      const [row] = await ex
        .insert(groupInvites)
        .values({ groupId, code: generateInviteCode(), createdBy: userId })
        .returning();
      return row;
    } catch (err) {
      if (attempt >= 2) throw err;
    }
  }
}
