import { NextResponse } from "next/server";

import { db } from "@/db";
import { assertGroupMember, getAuth } from "@/lib/auth";
import { withAuth } from "@/lib/auth/route";
import { currentInvite, rotateInvite } from "@/lib/invites";
import { logInviteReset } from "@/lib/record-mutation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * The group's live invite code, or `{ code: null }` for one that has none yet (every group made
 * before invites existed). A read never creates one: whoever presses 產生邀請碼 is the inviter
 * on record, not whoever happened to open the settings page.
 */
export const GET = withAuth(async (req: Request, { params }: Params) => {
  const auth = await getAuth(req);
  const groupId = Number((await params).id);
  if (!Number.isFinite(groupId)) {
    return NextResponse.json({ error: "invalid group id" }, { status: 400 });
  }
  await assertGroupMember(auth.user.id, groupId);

  const invite = await currentInvite(groupId);
  return NextResponse.json({ code: invite?.code ?? null });
});

/** Issues a code, revoking the current one if there is one. */
export const POST = withAuth(async (req: Request, { params }: Params) => {
  const auth = await getAuth(req);
  const groupId = Number((await params).id);
  if (!Number.isFinite(groupId)) {
    return NextResponse.json({ error: "invalid group id" }, { status: 400 });
  }
  await assertGroupMember(auth.user.id, groupId);

  const { invite, revoked } = await db.transaction((tx) => rotateInvite(tx, groupId, auth.user.id));
  // A first code is not a "reset"; only replacing a live one belongs in the feed.
  if (revoked > 0) await logInviteReset(groupId, { userId: auth.user.id, source: "app" });
  return NextResponse.json({ code: invite.code });
});
