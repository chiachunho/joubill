import { after, NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { getBot } from "@/bot";
import { db } from "@/db";
import { groups } from "@/db/schema";
import type { GroupChatResponse } from "@/lib/api-types";
import { assertGroupMember, getAuth } from "@/lib/auth";
import { withAuth } from "@/lib/auth/route";
import { telegramChatId } from "@/lib/chat";
import { chatTitleOf, leaveUnlinkedChat, unlinkChat } from "@/lib/group-chat";
import { logChatUnlinked } from "@/lib/record-mutation";
import { requireId } from "@/lib/route-params";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Whether the group is bound to a Telegram chat, and what that chat was called. */
export const GET = withAuth(async (req: Request, { params }: Params) => {
  const auth = await getAuth(req);
  const groupId = requireId((await params).id, "group id");
  await assertGroupMember(auth.user.id, groupId);

  const [group] = await db.select().from(groups).where(eq(groups.id, groupId));
  const chatId = group ? telegramChatId(group) : null;
  if (!group || chatId === null) {
    const body: GroupChatResponse = {
      linked: false,
      title: null,
      isForum: null,
      noticeThread: null,
    };
    return NextResponse.json(body);
  }

  // Topics can be switched on or off in Telegram at any time, so this is asked, not stored.
  const [title, isForum] = await Promise.all([
    chatTitleOf(groupId),
    getBot()
      .api.getChat(chatId)
      .then((chat) => ("is_forum" in chat ? chat.is_forum === true : false))
      .catch(() => null),
  ]);
  const body: GroupChatResponse = {
    linked: true,
    title,
    isForum,
    noticeThread:
      group.noticeThreadId === null
        ? null
        : { id: group.noticeThreadId, name: group.noticeThreadName },
  };
  return NextResponse.json(body);
});

/**
 * Detaches the group from its Telegram chat; any member may, like every other group setting.
 * The ledger, members and invite code are untouched. The bot says goodbye and leaves after the
 * response, and a failure there never undoes the unlink.
 */
export const DELETE = withAuth(async (req: Request, { params }: Params) => {
  const auth = await getAuth(req);
  const groupId = requireId((await params).id, "group id");
  await assertGroupMember(auth.user.id, groupId);

  // Read before the unlink: afterwards the group no longer knows which chat it had.
  const title = await chatTitleOf(groupId);
  const outcome = await unlinkChat(groupId);
  if (!outcome.ok) {
    return NextResponse.json({ error: "這個群組沒有綁定 Telegram 群組" }, { status: 409 });
  }

  await logChatUnlinked(groupId, { userId: auth.user.id, source: "app" }, title);
  after(() => leaveUnlinkedChat(getBot().api, outcome.target));
  return NextResponse.json({ ok: true });
});
