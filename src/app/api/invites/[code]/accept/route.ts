import { after, NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { groupMembers, users } from "@/db/schema";
import { getAuth } from "@/lib/auth";
import { withAuth } from "@/lib/auth/route";
import { CLAIM_UNAVAILABLE, INVITE_NOT_FOUND } from "@/lib/invite";
import { findActiveInvite } from "@/lib/invites";
import { enforceInviteRateLimit } from "@/lib/rate-limit";
import { labelUser } from "@/lib/label";
import { getBot } from "@/bot";
import { refreshClaimedNotices } from "@/lib/claim-notices";
import { mergeUserInto, type MergeResult } from "@/lib/member-merge-db";
import { logMemberClaimed, logMemberJoined } from "@/lib/record-mutation";
import { idSchema } from "@/lib/zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ code: string }> };

const bodySchema = z.object({ placeholderUserId: idSchema.optional() });

/**
 * Seats the caller in the group; an `inactive` member is reactivated. An optional
 * `placeholderUserId` ("I am this one") merges that placeholder into the caller in the
 * same transaction, so a failed claim doesn't leave the caller half-joined.
 */
export const POST = withAuth(async (req: Request, { params }: Params) => {
  const auth = await getAuth(req);
  await enforceInviteRateLimit(req, auth.user.id);
  const invite = await findActiveInvite((await params).code);
  if (!invite) {
    return NextResponse.json(
      { error: INVITE_NOT_FOUND.error },
      { status: INVITE_NOT_FOUND.status },
    );
  }

  const body = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const placeholderUserId = body.data.placeholderUserId;

  // One statement decides whether this call changed anything: a second tap or tab finds the
  // member already active, gets no row back, and so doesn't log a second "joined".
  // A refused claim throws so the transaction rolls the join back with it.
  class ClaimRefused extends Error {
    constructor(
      readonly status: number,
      message: string,
    ) {
      super(message);
    }
  }
  let changed: { userId: number }[];
  let claim: Extract<MergeResult, { ok: true }> | null;
  try {
    ({ changed, claim } = await db.transaction(async (tx) => {
      const rows = await tx
        .insert(groupMembers)
        .values({ groupId: invite.groupId, userId: auth.user.id, status: "active" })
        .onConflictDoUpdate({
          target: [groupMembers.groupId, groupMembers.userId],
          set: { status: "active" },
          setWhere: sql`${groupMembers.status} <> 'active'`,
        })
        .returning({ userId: groupMembers.userId });

      let claim: Extract<MergeResult, { ok: true }> | null = null;
      if (placeholderUserId !== undefined) {
        const merged = await mergeUserInto(tx, invite.groupId, placeholderUserId, auth.user.id);
        if (!merged.ok) {
          // A 404 is the one refusal the join page's picker can reach: the name was merged or
          // removed since the page loaded, so say that rather than echoing validateMerge's
          // English. Anything else comes from a hand-made body and keeps its own reason.
          throw new ClaimRefused(
            merged.status,
            merged.status === 404 ? CLAIM_UNAVAILABLE : merged.error,
          );
        }
        claim = merged;
      }
      return { changed: rows, claim };
    }));
  } catch (err) {
    if (err instanceof ClaimRefused) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }

  if (changed.length > 0) {
    const [inviter] = await db
      .select({
        displayName: users.displayName,
        firstName: users.firstName,
        lastName: users.lastName,
        username: users.username,
      })
      .from(users)
      .where(eq(users.id, invite.createdBy));
    await logMemberJoined(
      invite.groupId,
      { userId: auth.user.id, source: "app" },
      { id: invite.createdBy, name: labelUser(inviter ?? null) },
    );
  }

  if (claim && placeholderUserId !== undefined) {
    await logMemberClaimed(
      invite.groupId,
      { userId: auth.user.id, source: "app" },
      {
        placeholderId: placeholderUserId,
        placeholderName: claim.placeholderName,
        claimerId: auth.user.id,
        claimerName: claim.claimerName,
        recordIds: claim.recordIds,
      },
    );
    const claimed = claim;
    after(() => refreshClaimedNotices(getBot().api, claimed.recordIds));
  }

  return NextResponse.json({ groupId: invite.groupId });
});
