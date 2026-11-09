import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { getBot } from "@/bot";
import { db } from "@/db";
import { groupDeleteRequests, groups, users } from "@/db/schema";
import { telegramChatId } from "@/lib/chat";
import { chatTargetOf, sendToGroupChat } from "@/lib/notice-thread";
import { assertGroupMember, getAuth } from "@/lib/auth";
import { withAuth } from "@/lib/auth/route";
import { deleteGroup } from "@/lib/group-delete";
import { declinedNotice, deletedNotice } from "@/lib/group-delete-notice";
import { labelUser } from "@/lib/label";
import { requireId } from "@/lib/route-params";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export const GET = withAuth(async (req: Request, { params }: Params) => {
  const auth = await getAuth(req);
  const { id } = await params;
  const groupId = requireId(id, "group id");

  await assertGroupMember(auth.user.id, groupId);

  const [row] = await db
    .select({
      id: groupDeleteRequests.id,
      requestedBy: groupDeleteRequests.requestedBy,
      createdAt: groupDeleteRequests.createdAt,
      expiresAt: groupDeleteRequests.expiresAt,
      displayName: users.displayName,
      firstName: users.firstName,
      lastName: users.lastName,
      username: users.username,
    })
    .from(groupDeleteRequests)
    .innerJoin(users, eq(users.id, groupDeleteRequests.requestedBy))
    .where(eq(groupDeleteRequests.groupId, groupId));

  if (!row) return NextResponse.json({ request: null });

  // Clean up and treat as absent if expired
  if (row.expiresAt < new Date()) {
    await db.delete(groupDeleteRequests).where(eq(groupDeleteRequests.id, row.id));
    return NextResponse.json({ request: null });
  }

  return NextResponse.json({
    request: {
      id: row.id,
      requestedBy: row.requestedBy,
      requestedByName: labelUser({
        displayName: row.displayName,
        firstName: row.firstName,
        lastName: row.lastName,
        username: row.username,
      }),
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
    },
  });
});

// Approve the pending deletion request (any member other than the requester)
export const POST = withAuth(async (req: Request, { params }: Params) => {
  const auth = await getAuth(req);
  const { id } = await params;
  const groupId = requireId(id, "group id");

  await assertGroupMember(auth.user.id, groupId);

  const [request] = await db
    .select()
    .from(groupDeleteRequests)
    .where(eq(groupDeleteRequests.groupId, groupId));

  if (!request) {
    return NextResponse.json({ error: "no pending request" }, { status: 404 });
  }

  if (request.requestedBy === auth.user.id) {
    return NextResponse.json({ error: "cannot approve your own request" }, { status: 400 });
  }

  if (request.expiresAt < new Date()) {
    await db.delete(groupDeleteRequests).where(eq(groupDeleteRequests.id, request.id));
    return NextResponse.json({ error: "request expired" }, { status: 410 });
  }

  const [group] = await db.select().from(groups).where(eq(groups.id, groupId));
  if (!group) return NextResponse.json({ error: "group not found" }, { status: 404 });

  const { user } = auth;
  const name = labelUser({
    displayName: user.displayName,
    firstName: user.firstName,
    lastName: user.lastName,
    username: user.username,
  });
  // A group created on the web has no chat to tell or leave.
  const target = chatTargetOf(group);
  if (target !== null) {
    const { api } = getBot();
    const text = deletedNotice(name, group.title);
    if (request.telegramMessageId) {
      await api
        .editMessageText(target.chatId, request.telegramMessageId, text, { parse_mode: "HTML" })
        .catch(() => null);
    } else {
      await sendToGroupChat(
        api,
        target,
        (thread) => api.sendMessage(target.chatId, text, { ...thread, parse_mode: "HTML" }),
        { lastMessage: true },
      ).catch(() => null);
    }
    await api.leaveChat(target.chatId).catch(() => null);
  }
  await deleteGroup(groupId);

  return NextResponse.json({ ok: true });
});

// Cancel (requester) or reject (any other member) the pending request
export const DELETE = withAuth(async (req: Request, { params }: Params) => {
  const auth = await getAuth(req);
  const { id } = await params;
  const groupId = requireId(id, "group id");

  await assertGroupMember(auth.user.id, groupId);

  const [request] = await db
    .select()
    .from(groupDeleteRequests)
    .where(eq(groupDeleteRequests.groupId, groupId));

  if (!request) {
    return NextResponse.json({ error: "no pending request" }, { status: 404 });
  }

  const isRequester = request.requestedBy === auth.user.id;
  const [group] = await db.select().from(groups).where(eq(groups.id, groupId));

  const chatId = group ? telegramChatId(group) : null;
  if (request.telegramMessageId && chatId !== null) {
    const { user } = auth;
    const name = labelUser({
      displayName: user.displayName,
      firstName: user.firstName,
      lastName: user.lastName,
      username: user.username,
    });
    const bot = getBot();

    await bot.api
      .editMessageText(chatId, request.telegramMessageId, declinedNotice(name, isRequester), {
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: [] },
      })
      .catch(() => null);
  }

  await db.delete(groupDeleteRequests).where(eq(groupDeleteRequests.id, request.id));

  return NextResponse.json({ ok: true });
});
