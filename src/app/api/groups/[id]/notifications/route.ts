import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/db";
import { groupMembers } from "@/db/schema";
import type { GroupNotificationsResponse } from "@/lib/api-types";
import { assertGroupMember, getAuth } from "@/lib/auth";
import { withAuth } from "@/lib/auth/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

async function resolve(req: Request, ctx: Params) {
  const auth = await getAuth(req);
  const groupId = Number((await ctx.params).id);
  if (!Number.isFinite(groupId)) return null;
  await assertGroupMember(auth.user.id, groupId);
  return { userId: auth.user.id, groupId };
}

function where(ids: { userId: number; groupId: number }) {
  return and(eq(groupMembers.userId, ids.userId), eq(groupMembers.groupId, ids.groupId));
}

/** Whether the caller muted push for this group. Personal: other members are unaffected. */
export const GET = withAuth(async (req: Request, ctx: Params) => {
  const ids = await resolve(req, ctx);
  if (!ids) return NextResponse.json({ error: "invalid group id" }, { status: 400 });
  const [row] = await db
    .select({ muted: groupMembers.pushMuted })
    .from(groupMembers)
    .where(where(ids));
  const body: GroupNotificationsResponse = { muted: row?.muted ?? false };
  return NextResponse.json(body);
});

const patchSchema = z.object({ muted: z.boolean() }).strict();

export const PATCH = withAuth(async (req: Request, ctx: Params) => {
  const ids = await resolve(req, ctx);
  if (!ids) return NextResponse.json({ error: "invalid group id" }, { status: 400 });
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "格式錯誤" }, { status: 400 });

  await db.update(groupMembers).set({ pushMuted: parsed.data.muted }).where(where(ids));
  const body: GroupNotificationsResponse = { muted: parsed.data.muted };
  return NextResponse.json(body);
});
