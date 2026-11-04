import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/db";
import { groupMembers, groups } from "@/db/schema";
import type { GroupNotificationsResponse } from "@/lib/api-types";
import { assertGroupMember, getAuth } from "@/lib/auth";
import { withAuth } from "@/lib/auth/route";
import { telegramChatId } from "@/lib/chat";
import { requireId } from "@/lib/route-params";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

async function resolve(req: Request, ctx: Params) {
  const auth = await getAuth(req);
  const groupId = requireId((await ctx.params).id, "group id");
  await assertGroupMember(auth.user.id, groupId);
  return { userId: auth.user.id, groupId };
}

function where(ids: { userId: number; groupId: number }) {
  return and(eq(groupMembers.userId, ids.userId), eq(groupMembers.groupId, ids.groupId));
}

/** Whether the caller muted push for this group. Personal: other members are unaffected. */
export const GET = withAuth(async (req: Request, ctx: Params) => {
  const ids = await resolve(req, ctx);
  const [row] = await db
    .select({ muted: groupMembers.pushMuted, chatType: groups.chatType, chatId: groups.chatId })
    .from(groupMembers)
    .innerJoin(groups, eq(groups.id, groupMembers.groupId))
    .where(where(ids));
  const body: GroupNotificationsResponse = {
    muted: row?.muted ?? false,
    telegramLinked: row ? telegramChatId(row) !== null : false,
  };
  return NextResponse.json(body);
});

const patchSchema = z.strictObject({ muted: z.boolean() });

export const PATCH = withAuth(async (req: Request, ctx: Params) => {
  const ids = await resolve(req, ctx);
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "格式錯誤" }, { status: 400 });

  await db.update(groupMembers).set({ pushMuted: parsed.data.muted }).where(where(ids));
  return NextResponse.json({ muted: parsed.data.muted });
});
