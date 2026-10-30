import { NextResponse } from "next/server";
import { and, count, eq } from "drizzle-orm";

import { db } from "@/db";
import { groupMembers, users } from "@/db/schema";
import { getAuth } from "@/lib/auth";
import { withAuth } from "@/lib/auth/route";
import { INVITE_NOT_FOUND } from "@/lib/invite";
import { findActiveInvite } from "@/lib/invites";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ code: string }> };

/** Preview of what a code opens. Login is required so it can't be used to enumerate codes. */
export const GET = withAuth(async (req: Request, { params }: Params) => {
  const auth = await getAuth(req);
  const invite = await findActiveInvite((await params).code);
  if (!invite) {
    return NextResponse.json(
      { error: INVITE_NOT_FOUND.error },
      { status: INVITE_NOT_FOUND.status },
    );
  }

  const [{ memberCount }] = await db
    .select({ memberCount: count() })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, invite.groupId), eq(groupMembers.status, "active")));
  const [mine] = await db
    .select({ status: groupMembers.status })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, invite.groupId), eq(groupMembers.userId, auth.user.id)));

  const alreadyMember = mine?.status === "active";

  // Name-only members the visitor might be ("你是下面其中一位嗎？"). Only ids and names; a
  // joined member has no use for the list.
  const placeholders = alreadyMember
    ? []
    : await db
        .select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
        .from(users)
        .innerJoin(groupMembers, eq(groupMembers.userId, users.id))
        .where(
          and(
            eq(groupMembers.groupId, invite.groupId),
            eq(users.placeholderGroupId, invite.groupId),
          ),
        )
        .orderBy(users.id);

  return NextResponse.json({
    groupId: invite.groupId,
    title: invite.groupTitle,
    memberCount,
    alreadyMember,
    placeholders: placeholders.map((p) => ({
      id: p.id,
      name: [p.firstName, p.lastName].filter(Boolean).join(" "),
    })),
  });
});
