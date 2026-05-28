import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { expenseSplits, expenses } from "@/db/schema";
import { assertGroupMember, findUsersNotInGroup, getAuth } from "@/lib/auth";
import { withAuth } from "@/lib/auth/route";
import { n } from "@/lib/money";
import { expenseInputSchema } from "@/lib/zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; expenseId: string }> };

async function resolveIds({ params }: Params) {
  const { id, expenseId } = await params;
  const groupId = Number(id);
  const eid = Number(expenseId);
  if (!Number.isFinite(groupId) || !Number.isFinite(eid)) return null;
  return { groupId, eid };
}

export const GET = withAuth(async (req: Request, ctx: Params) => {
  const auth = await getAuth(req);
  const ids = await resolveIds(ctx);
  if (!ids) return NextResponse.json({ error: "invalid id" }, { status: 400 });
  await assertGroupMember(auth.user.id, ids.groupId);

  const [expense] = await db
    .select()
    .from(expenses)
    .where(and(eq(expenses.id, ids.eid), eq(expenses.groupId, ids.groupId)));
  if (!expense) return NextResponse.json({ error: "expense not found" }, { status: 404 });

  const splits = await db
    .select({
      debtorId: expenseSplits.debtorId,
      amount: expenseSplits.amount,
      shareType: expenseSplits.shareType,
    })
    .from(expenseSplits)
    .where(eq(expenseSplits.expenseId, ids.eid));

  return NextResponse.json({
    id: expense.id,
    amount: n(expense.amount),
    currency: expense.currency,
    description: expense.description,
    payerId: expense.payerId,
    spentAt: expense.spentAt,
    splits: splits.map((s) => ({
      debtorId: s.debtorId,
      amount: n(s.amount),
      shareType: s.shareType,
    })),
  });
});

export const PATCH = withAuth(async (req: Request, ctx: Params) => {
  const auth = await getAuth(req);
  const ids = await resolveIds(ctx);
  if (!ids) return NextResponse.json({ error: "invalid id" }, { status: 400 });
  await assertGroupMember(auth.user.id, ids.groupId);

  const parsed = expenseInputSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const input = parsed.data;

  const [existing] = await db
    .select({ id: expenses.id })
    .from(expenses)
    .where(and(eq(expenses.id, ids.eid), eq(expenses.groupId, ids.groupId)));
  if (!existing) return NextResponse.json({ error: "expense not found" }, { status: 404 });

  const userIds = Array.from(new Set([input.payerId, ...input.splits.map((s) => s.debtorId)]));
  const missing = await findUsersNotInGroup(ids.groupId, userIds);
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `users not in group: ${missing.join(",")}` },
      { status: 400 },
    );
  }

  await db
    .update(expenses)
    .set({
      payerId: input.payerId,
      amount: input.amount.toFixed(2),
      currency: input.currency,
      description: input.description,
      spentAt: new Date(input.spentAt),
      updatedAt: new Date(),
    })
    .where(eq(expenses.id, ids.eid));

  // Replace splits wholesale. FK cascade not relevant since we're keeping the
  // parent expense row; just delete-then-insert in order.
  await db.delete(expenseSplits).where(eq(expenseSplits.expenseId, ids.eid));
  await db.insert(expenseSplits).values(
    input.splits.map((s) => ({
      expenseId: ids.eid,
      debtorId: s.debtorId,
      amount: s.amount.toFixed(2),
      shareType: input.shareType,
    })),
  );

  return NextResponse.json({ ok: true });
});

export const DELETE = withAuth(async (req: Request, ctx: Params) => {
  const auth = await getAuth(req);
  const ids = await resolveIds(ctx);
  if (!ids) return NextResponse.json({ error: "invalid id" }, { status: 400 });
  await assertGroupMember(auth.user.id, ids.groupId);

  const result = await db
    .delete(expenses)
    .where(and(eq(expenses.id, ids.eid), eq(expenses.groupId, ids.groupId)))
    .returning({ id: expenses.id });

  if (result.length === 0) {
    return NextResponse.json({ error: "expense not found" }, { status: 404 });
  }
  // expense_splits cascade-deleted via FK.
  return NextResponse.json({ ok: true });
});
