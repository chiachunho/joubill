import { NextResponse } from "next/server";
import { and, countDistinct, eq, exists, or, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { expenses, expensePayers, expenseSplits, groupMembers, users } from "@/db/schema";
import { assertGroupMember, getAuth } from "@/lib/auth";
import { withAuth } from "@/lib/auth/route";
import { lockGroupMemberNames } from "@/lib/member-name-lock";
import { isDuplicateName, placeholderNameSchema } from "@/lib/placeholder";
import { requireId } from "@/lib/route-params";

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
  const groupId = requireId(id, "group id");
  const targetUserId = requireId(userId, "user id");
  await assertGroupMember(auth.user.id, groupId);

  const body = patchSchema.safeParse(await req.json());
  if (!body.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  if ("firstName" in body.data) {
    const newName = body.data.firstName;
    const result = await db.transaction(async (tx) => {
      await lockGroupMemberNames(tx, groupId);
      const rows = await tx
        .select({
          id: users.id,
          displayName: users.displayName,
          firstName: users.firstName,
          lastName: users.lastName,
          placeholderGroupId: users.placeholderGroupId,
        })
        .from(users)
        .innerJoin(groupMembers, eq(groupMembers.userId, users.id))
        .where(eq(groupMembers.groupId, groupId));
      const target = rows.find((m) => m.id === targetUserId);
      if (!target) return "not-found" as const;
      // A real account's name belongs to its owner (it is refreshed from Telegram).
      if (target.placeholderGroupId !== groupId) return "not-placeholder" as const;
      if (isDuplicateName(newName, rows, targetUserId)) return "duplicate" as const;
      await tx
        .update(users)
        .set({ firstName: newName, updatedAt: new Date() })
        .where(eq(users.id, targetUserId));
      return "ok" as const;
    });
    if (result === "not-found") {
      return NextResponse.json({ error: "member not found" }, { status: 404 });
    }
    if (result === "not-placeholder") {
      return NextResponse.json(
        { error: "only placeholder members can be renamed" },
        { status: 403 },
      );
    }
    if (result === "duplicate") {
      return NextResponse.json({ error: "名字已被群組成員使用" }, { status: 409 });
    }
    return NextResponse.json({ firstName: newName });
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
  const groupId = requireId(id, "group id");
  const targetUserId = requireId(userId, "user id");
  await assertGroupMember(auth.user.id, groupId);

  if (auth.user.id === targetUserId) {
    return NextResponse.json({ error: "cannot remove yourself" }, { status: 400 });
  }

  // Block removal if the member is referenced by any record in this group, either as a
  // debtor (expense_splits) or a payer (expense_payers). Missing the payer side lets a
  // payer-only member be deleted, which orphans their recorded contribution on edit.
  // Counted per record: someone who both paid and shares one expense is one record, not two,
  // since the number is shown to the person as "還有 N 筆紀錄".
  const [{ expenseCount }] = await db
    .select({ expenseCount: countDistinct(expenses.id) })
    .from(expenses)
    .where(
      and(
        eq(expenses.groupId, groupId),
        or(
          exists(
            db
              .select({ one: sql`1` })
              .from(expenseSplits)
              .where(
                and(
                  eq(expenseSplits.expenseId, expenses.id),
                  eq(expenseSplits.debtorId, targetUserId),
                ),
              ),
          ),
          exists(
            db
              .select({ one: sql`1` })
              .from(expensePayers)
              .where(
                and(
                  eq(expensePayers.expenseId, expenses.id),
                  eq(expensePayers.payerId, targetUserId),
                ),
              ),
          ),
        ),
      ),
    );
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
