import { NextResponse } from "next/server";

import { assertGroupMember, getAuth } from "@/lib/auth";
import { withAuth } from "@/lib/auth/route";
import { changeNoticeThread } from "@/lib/group-notice-thread";
import { requireId } from "@/lib/route-params";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * Puts 記帳通知發送位置 back to the chat's General; any member may, like every group setting.
 * There is no PUT: the Bot API can't list a chat's topics, so a topic is chosen with `/topic`
 * inside it, in Telegram.
 */
export const DELETE = withAuth(async (req: Request, { params }: Params) => {
  const auth = await getAuth(req);
  const groupId = requireId((await params).id, "group id");
  await assertGroupMember(auth.user.id, groupId);

  const result = await changeNoticeThread(groupId, null, { userId: auth.user.id, source: "app" });
  if (!result.ok) {
    return result.reason === "not_found"
      ? NextResponse.json({ error: "group not found" }, { status: 404 })
      : NextResponse.json({ error: "這個群組沒有綁定 Telegram 群組" }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
});
