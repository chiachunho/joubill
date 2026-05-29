import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { db } from "@/db";
import { settlements, users } from "@/db/schema";
import { assertGroupMember, getAuth } from "@/lib/auth";
import { withAuth } from "@/lib/auth/route";
import { n } from "@/lib/money";
import { settlementInputSchema } from "@/lib/zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; settlementId: string }> };

async function resolveParams(params: Params["params"]) {
  const p = await params;
  const groupId = Number(p.id);
  const settlementId = Number(p.settlementId);
  return { groupId, settlementId };
}

export const GET = withAuth(async (req: Request, { params }: Params) => {
  const auth = await getAuth(req);
  const { groupId, settlementId } = await resolveParams(params);
  if (!Number.isFinite(groupId) || !Number.isFinite(settlementId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  await assertGroupMember(auth.user.id, groupId);

  const fromUser = alias(users, "from_user");
  const toUser = alias(users, "to_user");

  const [row] = await db
    .select({
      id: settlements.id,
      fromUserId: settlements.fromUserId,
      fromFirstName: fromUser.firstName,
      fromLastName: fromUser.lastName,
      fromUsername: fromUser.username,
      toUserId: settlements.toUserId,
      toFirstName: toUser.firstName,
      toLastName: toUser.lastName,
      toUsername: toUser.username,
      amount: settlements.amount,
      currency: settlements.currency,
      settledAt: settlements.settledAt,
    })
    .from(settlements)
    .innerJoin(fromUser, eq(fromUser.id, settlements.fromUserId))
    .innerJoin(toUser, eq(toUser.id, settlements.toUserId))
    .where(and(eq(settlements.id, settlementId), eq(settlements.groupId, groupId)));

  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });

  return NextResponse.json({
    id: row.id,
    amount: n(row.amount),
    currency: row.currency,
    settledAt: row.settledAt,
    from: {
      userId: row.fromUserId,
      firstName: row.fromFirstName,
      lastName: row.fromLastName,
      username: row.fromUsername,
    },
    to: {
      userId: row.toUserId,
      firstName: row.toFirstName,
      lastName: row.toLastName,
      username: row.toUsername,
    },
  });
});

export const PATCH = withAuth(async (req: Request, { params }: Params) => {
  const auth = await getAuth(req);
  const { groupId, settlementId } = await resolveParams(params);
  if (!Number.isFinite(groupId) || !Number.isFinite(settlementId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  await assertGroupMember(auth.user.id, groupId);

  const parsed = settlementInputSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const input = parsed.data;

  if (input.fromUserId === input.toUserId) {
    return NextResponse.json({ error: "from and to must differ" }, { status: 400 });
  }

  const [existing] = await db
    .select({ id: settlements.id })
    .from(settlements)
    .where(and(eq(settlements.id, settlementId), eq(settlements.groupId, groupId)));

  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  await db
    .update(settlements)
    .set({
      fromUserId: input.fromUserId,
      toUserId: input.toUserId,
      amount: input.amount.toFixed(2),
      currency: input.currency,
      settledAt: input.settledAt ? new Date(input.settledAt) : undefined,
    })
    .where(eq(settlements.id, settlementId));

  return NextResponse.json({ ok: true });
});

export const DELETE = withAuth(async (req: Request, { params }: Params) => {
  const auth = await getAuth(req);
  const { groupId, settlementId } = await resolveParams(params);
  if (!Number.isFinite(groupId) || !Number.isFinite(settlementId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  await assertGroupMember(auth.user.id, groupId);

  const [existing] = await db
    .select({ id: settlements.id })
    .from(settlements)
    .where(and(eq(settlements.id, settlementId), eq(settlements.groupId, groupId)));

  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  await db.delete(settlements).where(eq(settlements.id, settlementId));

  return NextResponse.json({ ok: true });
});
