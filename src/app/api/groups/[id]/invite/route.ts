import { NextResponse } from "next/server";

import { db } from "@/db";
import { assertGroupMember, getAuth } from "@/lib/auth";
import { withAuth } from "@/lib/auth/route";
import { currentInvite, rotateInvite } from "@/lib/invites";
import { logInviteReset } from "@/lib/record-mutation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** The group's live invite code, issuing one if it has none (older groups). */
export const GET = withAuth(async (req: Request, { params }: Params) => {
  const auth = await getAuth(req);
  const groupId = Number((await params).id);
  if (!Number.isFinite(groupId)) {
    return NextResponse.json({ error: "invalid group id" }, { status: 400 });
  }
  await assertGroupMember(auth.user.id, groupId);

  const invite =
    (await currentInvite(groupId)) ??
    (await db.transaction((tx) => rotateInvite(tx, groupId, auth.user.id)));
  return NextResponse.json({ code: invite.code });
});

/** Revokes the current code and issues a new one. */
export const POST = withAuth(async (req: Request, { params }: Params) => {
  const auth = await getAuth(req);
  const groupId = Number((await params).id);
  if (!Number.isFinite(groupId)) {
    return NextResponse.json({ error: "invalid group id" }, { status: 400 });
  }
  await assertGroupMember(auth.user.id, groupId);

  const invite = await db.transaction((tx) => rotateInvite(tx, groupId, auth.user.id));
  await logInviteReset(groupId, { userId: auth.user.id, source: "app" });
  return NextResponse.json({ code: invite.code });
});
