import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { db } from "@/db";
import { settlements, users } from "@/db/schema";
import { assertGroupMember, findUsersNotInGroup, getAuth } from "@/lib/auth";
import { withAuth } from "@/lib/auth/route";
import { n } from "@/lib/money";
import { settlementInputSchema } from "@/lib/zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export const GET = withAuth(async (req: Request, { params }: Params) => {
  const auth = await getAuth(req);
  const groupId = Number((await params).id);
  if (!Number.isFinite(groupId)) {
    return NextResponse.json({ error: "invalid group id" }, { status: 400 });
  }
  await assertGroupMember(auth.user.id, groupId);

  const fromUser = alias(users, "from_user");
  const toUser = alias(users, "to_user");

  const rows = await db
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
    .where(eq(settlements.groupId, groupId))
    .orderBy(desc(settlements.settledAt));

  return NextResponse.json({
    settlements: rows.map((r) => ({
      id: r.id,
      amount: n(r.amount),
      currency: r.currency,
      settledAt: r.settledAt,
      from: {
        userId: r.fromUserId,
        firstName: r.fromFirstName,
        lastName: r.fromLastName,
        username: r.fromUsername,
      },
      to: {
        userId: r.toUserId,
        firstName: r.toFirstName,
        lastName: r.toLastName,
        username: r.toUsername,
      },
    })),
  });
});

export const POST = withAuth(async (req: Request, { params }: Params) => {
  const auth = await getAuth(req);
  const groupId = Number((await params).id);
  if (!Number.isFinite(groupId)) {
    return NextResponse.json({ error: "invalid group id" }, { status: 400 });
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

  const missing = await findUsersNotInGroup(groupId, [input.fromUserId, input.toUserId]);
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `users not in group: ${missing.join(",")}` },
      { status: 400 },
    );
  }

  const [row] = await db
    .insert(settlements)
    .values({
      groupId,
      fromUserId: input.fromUserId,
      toUserId: input.toUserId,
      amount: input.amount.toFixed(2),
      currency: input.currency,
      settledAt: input.settledAt ? new Date(input.settledAt) : new Date(),
    })
    .returning({ id: settlements.id });

  return NextResponse.json({ id: row.id }, { status: 201 });
});
