import { NextResponse } from "next/server";
import { and, count, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { expenses, expensePayers, expenseSplits, groupMembers, users } from "@/db/schema";
import { assertGroupMember, getAuth } from "@/lib/auth";
import { withAuth } from "@/lib/auth/route";
import { isDuplicateName, placeholderNameSchema } from "@/lib/placeholder";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; userId: string }> };

// Either toggle status (any member) or rename (placeholders only).
const patchSchema = z.union([
  z.object({ status: z.enum(["active", "inactive"]) }),
  z.object({ firstName: placeholderNameSchema }),
]);

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

  if ("firstName" in body.data) {
    const rows = await db
      .select({
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        placeholderGroupId: users.placeholderGroupId,
      })
      .from(users)
      .innerJoin(groupMembers, eq(groupMembers.userId, users.id))
      .where(eq(groupMembers.groupId, groupId));
    const target = rows.find((m) => m.id === targetUserId);
    if (!target) return NextResponse.json({ error: "member not found" }, { status: 404 });
    // A real account's name belongs to its owner (it is refreshed from Telegram).
    if (target.placeholderGroupId !== groupId) {
      return NextResponse.json(
        { error: "only placeholder members can be renamed" },
        { status: 403 },
      );
    }
    if (isDuplicateName(body.data.firstName, rows, targetUserId)) {
      return NextResponse.json({ error: "名字已被群組成員使用" }, { status: 409 });
    }
    await db
      .update(users)
      .set({ firstName: body.data.firstName, updatedAt: new Date() })
      .where(eq(users.id, targetUserId));
    return NextResponse.json({ firstName: body.data.firstName });
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

  // Block removal if the member is referenced by any expense in this group, either as
  // a debtor (expense_splits) or a payer (expense_payers). Missing the payer side lets
  // a payer-only member be deleted, which orphans their recorded contribution on edit.
  const [{ debtorCount }] = await db
    .select({ debtorCount: count() })
    .from(expenseSplits)
    .innerJoin(expenses, eq(expenses.id, expenseSplits.expenseId))
    .where(and(eq(expenseSplits.debtorId, targetUserId), eq(expenses.groupId, groupId)));

  const [{ payerCount }] = await db
    .select({ payerCount: count() })
    .from(expensePayers)
    .innerJoin(expenses, eq(expenses.id, expensePayers.expenseId))
    .where(and(eq(expensePayers.payerId, targetUserId), eq(expenses.groupId, groupId)));

  const expenseCount = debtorCount + payerCount;
  if (expenseCount > 0) {
    return NextResponse.json({ error: "has expenses", expenseCount }, { status: 409 });
  }

  await db.transaction(async (tx) => {
    await tx
      .delete(groupMembers)
      .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, targetUserId)));

    // A placeholder exists only for this group; with no records left, drop the row too.
    await tx
      .delete(users)
      .where(and(eq(users.id, targetUserId), eq(users.placeholderGroupId, groupId)));
  });

  return NextResponse.json({ ok: true });
});
