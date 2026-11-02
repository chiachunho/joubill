import { NextResponse } from "next/server";

import { getBot } from "@/bot";
import { db } from "@/db";
import { assertGroupMember, getAuth } from "@/lib/auth";
import { withAuth } from "@/lib/auth/route";
import { botUsername } from "@/lib/bot-username";
import { joinLink } from "@/lib/deep-link";
import { currentInvite, rotateInvite } from "@/lib/invites";
import { logInviteReset } from "@/lib/record-mutation";
import { requireId } from "@/lib/route-params";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The Mini App link for a code, or null when the bot's username can't be had. */
async function miniLinkFor(code: string | undefined): Promise<string | null> {
  if (!code) return null;
  // The link is an extra: an incomplete env or an unreachable Telegram must not fail the request,
  // least of all a POST that has already rotated the code.
  try {
    const username = await botUsername(getBot().api);
    return username ? joinLink(username, code) : null;
  } catch {
    return null;
  }
}

type Params = { params: Promise<{ id: string }> };

/**
 * The group's live invite code, or `{ code: null }` for one that has none yet (every group made
 * before invites existed). A read never creates one: whoever presses 產生邀請碼 is the inviter
 * on record, not whoever happened to open the settings page.
 */
export const GET = withAuth(async (req: Request, { params }: Params) => {
  const auth = await getAuth(req);
  const groupId = requireId((await params).id, "group id");
  await assertGroupMember(auth.user.id, groupId);

  const invite = await currentInvite(groupId);
  return NextResponse.json({
    code: invite?.code ?? null,
    miniLink: await miniLinkFor(invite?.code),
  });
});

/** Issues a code, revoking the current one if there is one. */
export const POST = withAuth(async (req: Request, { params }: Params) => {
  const auth = await getAuth(req);
  const groupId = requireId((await params).id, "group id");
  await assertGroupMember(auth.user.id, groupId);

  const { invite, revoked } = await db.transaction((tx) => rotateInvite(tx, groupId, auth.user.id));
  // A first code is not a "reset"; only replacing a live one belongs in the feed.
  if (revoked > 0) await logInviteReset(groupId, { userId: auth.user.id, source: "app" });
  return NextResponse.json({ code: invite.code, miniLink: await miniLinkFor(invite.code) });
});
