import { NextResponse } from "next/server";
import { count, eq } from "drizzle-orm";

import { getBot } from "@/bot";
import { db } from "@/db";
import { groupDeleteRequests, groupMembers, groups } from "@/db/schema";
import { assertGroupMember, getAuth } from "@/lib/auth";
import { withAuth } from "@/lib/auth/route";
import { labelUser } from "@/lib/label";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const EXPIRY_MS = 48 * 60 * 60 * 1000; // 48 hours

export const DELETE = withAuth(async (req: Request, { params }: Params) => {
  const auth = await getAuth(req);
  const { id } = await params;
  const groupId = Number(id);

  if (!Number.isFinite(groupId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  await assertGroupMember(auth.user.id, groupId);

  const [group] = await db.select().from(groups).where(eq(groups.id, groupId));
  if (!group) {
    return NextResponse.json({ error: "group not found" }, { status: 404 });
  }

  const [{ memberCount }] = await db
    .select({ memberCount: count() })
    .from(groupMembers)
    .where(eq(groupMembers.groupId, groupId));

  const { user } = auth;
  const name = labelUser({ firstName: user.firstName, lastName: user.lastName, username: user.username });
  const bot = getBot();

  // Single member — delete immediately without requiring approval
  if (memberCount <= 1) {
    await bot.api
      .sendMessage(group.telegramChatId, `${name} 已刪除揪帳群組，所有費用與結算紀錄均已清除。`)
      .catch(() => null);
    await bot.api.leaveChat(group.telegramChatId).catch(() => null);
    await db.delete(groups).where(eq(groups.id, groupId));
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

  const sent = await bot.api
    .sendMessage(
      group.telegramChatId,
      `${name} 申請刪除揪帳群組「${group.title}」，需要其他成員確認。\n\n同意後所有費用與結算紀錄將永久清除。`,
      {
        reply_markup: {
          inline_keyboard: [
            [
              { text: "✓ 同意刪除", callback_data: `approve_del:${request.id}` },
              { text: "✗ 拒絕", callback_data: `cancel_del:${request.id}` },
            ],
          ],
        },
      },
    )
    .catch(() => null);

  if (sent) {
    await db
      .update(groupDeleteRequests)
      .set({ telegramMessageId: sent.message_id })
      .where(eq(groupDeleteRequests.id, request.id));
  }

  return NextResponse.json({ pending: true, requestId: request.id });
});
