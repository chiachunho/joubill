import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { groupMembers, users } from "@/db/schema";
import { getAuth } from "@/lib/auth";
import { withAuth } from "@/lib/auth/route";
import { findActiveInvite, INVITE_NOT_FOUND } from "@/lib/invites";
import { labelUser } from "@/lib/label";
import { logMemberJoined } from "@/lib/record-mutation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ code: string }> };

/** Seats the caller in the group; an `inactive` member is reactivated. */
export const POST = withAuth(async (req: Request, { params }: Params) => {
  const auth = await getAuth(req);
  const invite = await findActiveInvite((await params).code);
  if (!invite) {
    return NextResponse.json(
      { error: INVITE_NOT_FOUND.error },
      { status: INVITE_NOT_FOUND.status },
    );
  }

  const [before] = await db
    .select({ status: groupMembers.status })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, invite.groupId), eq(groupMembers.userId, auth.user.id)));

  await db
    .insert(groupMembers)
    .values({ groupId: invite.groupId, userId: auth.user.id, status: "active" })
    .onConflictDoUpdate({
      target: [groupMembers.groupId, groupMembers.userId],
      set: { status: "active" },
    });

  // Re-accepting a link you already used is a no-op, not a second "joined" row.
  if (before?.status !== "active") {
    const [inviter] = await db
      .select({ firstName: users.firstName, lastName: users.lastName, username: users.username })
      .from(users)
      .where(eq(users.id, invite.createdBy));
    await logMemberJoined(
      invite.groupId,
      { userId: auth.user.id, source: "app" },
      { id: invite.createdBy, name: labelUser(inviter ?? null) },
    );
  }

  return NextResponse.json({ groupId: invite.groupId });
});
