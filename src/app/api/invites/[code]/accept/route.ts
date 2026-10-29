import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { groupMembers, users } from "@/db/schema";
import { getAuth } from "@/lib/auth";
import { withAuth } from "@/lib/auth/route";
import { INVITE_NOT_FOUND } from "@/lib/invite";
import { findActiveInvite } from "@/lib/invites";
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

  // One statement decides whether this call changed anything: a second tap or tab finds the
  // member already active, gets no row back, and so doesn't log a second "joined".
  const changed = await db
    .insert(groupMembers)
    .values({ groupId: invite.groupId, userId: auth.user.id, status: "active" })
    .onConflictDoUpdate({
      target: [groupMembers.groupId, groupMembers.userId],
      set: { status: "active" },
      setWhere: sql`${groupMembers.status} <> 'active'`,
    })
    .returning({ userId: groupMembers.userId });

  if (changed.length > 0) {
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
