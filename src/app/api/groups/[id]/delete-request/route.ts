import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { getBot } from "@/bot";
import { db } from "@/db";
import { groupDeleteRequests, groups, users } from "@/db/schema";
import { requireTelegramChatId } from "@/lib/chat";
import { assertGroupMember, getAuth } from "@/lib/auth";
import { withAuth } from "@/lib/auth/route";
import { labelUser } from "@/lib/label";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export const GET = withAuth(async (req: Request, { params }: Params) => {
  const auth = await getAuth(req);
  const { id } = await params;
  const groupId = Number(id);

  if (!Number.isFinite(groupId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  await assertGroupMember(auth.user.id, groupId);

  const [row] = await db
    .select({
      id: groupDeleteRequests.id,
      requestedBy: groupDeleteRequests.requestedBy,
      createdAt: groupDeleteRequests.createdAt,
      expiresAt: groupDeleteRequests.expiresAt,
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
  const groupId = Number(id);

  if (!Number.isFinite(groupId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

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
    firstName: user.firstName,
    lastName: user.lastName,
    username: user.username,
  });
  const bot = getBot();

  if (request.telegramMessageId) {
    await bot.api
      .editMessageText(
        requireTelegramChatId(group),
        request.telegramMessageId,
        `${name} 同意刪除群組，揪帳已關閉。所有費用與結算紀錄均已清除。`,
      )
      .catch(() => null);
  } else {
    await bot.api
      .sendMessage(
        requireTelegramChatId(group),
        `${name} 同意刪除群組，揪帳已關閉。所有費用與結算紀錄均已清除。`,
      )
      .catch(() => null);
  }

  await bot.api.leaveChat(requireTelegramChatId(group)).catch(() => null);
  await db.delete(groups).where(eq(groups.id, groupId));

  return NextResponse.json({ ok: true });
});

// Cancel (requester) or reject (any other member) the pending request
export const DELETE = withAuth(async (req: Request, { params }: Params) => {
  const auth = await getAuth(req);
  const { id } = await params;
  const groupId = Number(id);

  if (!Number.isFinite(groupId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

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

  if (request.telegramMessageId && group) {
    const { user } = auth;
    const name = labelUser({
      firstName: user.firstName,
      lastName: user.lastName,
      username: user.username,
    });
    const action = isRequester ? "取消了刪除申請" : "拒絕了刪除申請";
    const bot = getBot();

    await bot.api
      .editMessageText(requireTelegramChatId(group), request.telegramMessageId, `${name} ${action}。`, {
        reply_markup: { inline_keyboard: [] },
      })
      .catch(() => null);
  }

  await db.delete(groupDeleteRequests).where(eq(groupDeleteRequests.id, request.id));

  return NextResponse.json({ ok: true });
});
