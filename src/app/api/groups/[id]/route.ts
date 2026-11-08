import { NextResponse } from "next/server";
import { and, count, eq, isNull } from "drizzle-orm";

import { getBot } from "@/bot";
import { db } from "@/db";
import { groupDeleteRequests, groupMembers, groups, users } from "@/db/schema";
import { chatTargetOf, sendToGroupChat } from "@/lib/notice-thread";
import { assertGroupMember, getAuth } from "@/lib/auth";
import { withAuth } from "@/lib/auth/route";
import { BTN } from "@/lib/buttons";
import { deleteGroup } from "@/lib/group-delete";
import { labelUser } from "@/lib/label";
import { requireId } from "@/lib/route-params";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const EXPIRY_MS = 48 * 60 * 60 * 1000; // 48 hours

export const DELETE = withAuth(async (req: Request, { params }: Params) => {
  const auth = await getAuth(req);
  const { id } = await params;
  const groupId = requireId(id, "group id");

  await assertGroupMember(auth.user.id, groupId);

  const [group] = await db.select().from(groups).where(eq(groups.id, groupId));
  if (!group) {
    return NextResponse.json({ error: "group not found" }, { status: 404 });
  }

  // Members without an account can't approve a deletion request, so they must not
  // count: a solo owner with a placeholder would otherwise be unable to delete.
  const [{ memberCount }] = await db
    .select({ memberCount: count() })
    .from(groupMembers)
    .innerJoin(users, eq(users.id, groupMembers.userId))
    .where(and(eq(groupMembers.groupId, groupId), isNull(users.placeholderGroupId)));

  const { user } = auth;
  const name = labelUser({
    displayName: user.displayName,
    firstName: user.firstName,
    lastName: user.lastName,
    username: user.username,
  });
  // A group created on the web has no chat: nothing to announce and nothing to leave.
  const target = chatTargetOf(group);

  // Single member — delete immediately without requiring approval
  if (memberCount <= 1) {
    if (target !== null) {
      const { api } = getBot();
      await sendToGroupChat(
        api,
        target,
        (thread) =>
          api.sendMessage(
            target.chatId,
            `${name} 已刪除揪帳群組，所有費用與結算紀錄均已清除。`,
            thread,
          ),
        { lastMessage: true },
      ).catch(() => null);
      await api.leaveChat(target.chatId).catch(() => null);
    }
    await deleteGroup(groupId);
    return NextResponse.json({ ok: true });
  }

  // Multiple members — create a pending request that requires a second member to approve
  const [existing] = await db
    .select()
    .from(groupDeleteRequests)
    .where(eq(groupDeleteRequests.groupId, groupId));

  if (existing) {
    if (existing.expiresAt >= new Date()) {
      return NextResponse.json({ pending: true, requestId: existing.id });
    }
    // Expired — clean it up and fall through to create a fresh request
    await db.delete(groupDeleteRequests).where(eq(groupDeleteRequests.id, existing.id));
  }

  const expiresAt = new Date(Date.now() + EXPIRY_MS);
  const [request] = await db
    .insert(groupDeleteRequests)
    .values({ groupId, requestedBy: user.id, expiresAt })
    .returning();

  // The request lives in the DB; the other members approve it in the app (and, for a group
  // with a chat, on the message below).
  if (target !== null) {
    const { api } = getBot();
    const sent = await sendToGroupChat(api, target, (thread) =>
      api.sendMessage(
        target.chatId,
        `${name} 申請刪除揪帳群組「${group.title}」，需要其他成員確認。\n\n同意後所有費用與結算紀錄將永久清除。`,
        {
          ...thread,
          reply_markup: {
            inline_keyboard: [
              [
                { text: BTN.approveDeleteGroup, callback_data: `approve_del:${request.id}` },
                { text: BTN.rejectDeleteGroup, callback_data: `cancel_del:${request.id}` },
              ],
            ],
          },
        },
      ),
    ).catch(() => null);

    if (sent) {
      await db
        .update(groupDeleteRequests)
        .set({ telegramMessageId: sent.message_id })
        .where(eq(groupDeleteRequests.id, request.id));
    }
  }

  return NextResponse.json({ pending: true, requestId: request.id });
});
