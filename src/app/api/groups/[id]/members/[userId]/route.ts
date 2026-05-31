import { NextResponse } from "next/server";
import { and, count, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { expenseSplits, groupMembers } from "@/db/schema";
import { assertGroupMember, getAuth } from "@/lib/auth";
import { withAuth } from "@/lib/auth/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; userId: string }> };

const patchSchema = z.object({
  status: z.enum(["active", "inactive"]),
});

export const PATCH = withAuth(async (req: Request, { params }: Params) => {
  const auth = await getAuth(req);
  const { id, userId } = await params;
  const groupId = Number(id);
  const targetUserId = Number(userId);

  if (!Number.isFinite(groupId) || !Number.isFinite(targetUserId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  await assertGroupMember(auth.user.id, groupId);

  const body = patchSchema.safeParse(await req.json());
  if (!body.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const [updated] = await db
    .update(groupMembers)
    .set({ status: body.data.status })
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, targetUserId)))
    .returning();

  if (!updated) {
    return NextResponse.json({ error: "member not found" }, { status: 404 });
  }

  return NextResponse.json({ status: updated.status });
});

export const DELETE = withAuth(async (req: Request, { params }: Params) => {
  const auth = await getAuth(req);
  const { id, userId } = await params;
  const groupId = Number(id);
  const targetUserId = Number(userId);

  if (!Number.isFinite(groupId) || !Number.isFinite(targetUserId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  await assertGroupMember(auth.user.id, groupId);

  if (auth.user.id === targetUserId) {
    return NextResponse.json({ error: "cannot remove yourself" }, { status: 400 });
  }

  const [{ expenseCount }] = await db
    .select({ expenseCount: count() })
    .from(expenseSplits)
    .innerJoin(
      groupMembers,
      and(
        eq(groupMembers.userId, expenseSplits.debtorId),
        eq(groupMembers.groupId, groupId),
      ),
    )
    .where(eq(expenseSplits.debtorId, targetUserId));

  if (expenseCount > 0) {
    return NextResponse.json({ error: "has expenses", expenseCount }, { status: 409 });
  }

  await db
    .delete(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, targetUserId)));

  return NextResponse.json({ ok: true });
});
