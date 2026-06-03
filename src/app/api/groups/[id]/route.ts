import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { getBot } from "@/bot";
import { db } from "@/db";
import { groups } from "@/db/schema";
import { assertGroupMember, getAuth } from "@/lib/auth";
import { withAuth } from "@/lib/auth/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

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

  const { user } = auth;
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ") || user.username || "某人";
  const bot = getBot();

  await bot.api
    .sendMessage(
      group.telegramChatId,
      `${name} 已刪除揪帳群組，所有費用與結算紀錄均已清除。`,
    )
    .catch(() => null);

  await bot.api.leaveChat(group.telegramChatId).catch(() => null);

  await db.delete(groups).where(eq(groups.id, groupId));

  return NextResponse.json({ ok: true });
});
