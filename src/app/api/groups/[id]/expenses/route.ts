import { NextResponse } from "next/server";
import { desc, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { expenseSplits, expenses, users } from "@/db/schema";
import { assertGroupMember, findUsersNotInGroup, getAuth } from "@/lib/auth";
import { withAuth } from "@/lib/auth/route";
import { n } from "@/lib/money";
import { expenseInputSchema } from "@/lib/zod";

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

  const expenseRows = await db
    .select({
      id: expenses.id,
      amount: expenses.amount,
      currency: expenses.currency,
      description: expenses.description,
      spentAt: expenses.spentAt,
      payerId: expenses.payerId,
      receiptFileId: expenses.receiptFileId,
      payerFirstName: users.firstName,
      payerLastName: users.lastName,
      payerUsername: users.username,
    })
    .from(expenses)
    .innerJoin(users, eq(users.id, expenses.payerId))
    .where(eq(expenses.groupId, groupId))
    .orderBy(desc(expenses.spentAt));

  if (expenseRows.length === 0) {
    return NextResponse.json({ expenses: [] });
  }

  const expenseIds = expenseRows.map((e) => e.id);
  const splitRows = await db
    .select({
      expenseId: expenseSplits.expenseId,
      debtorId: expenseSplits.debtorId,
      amount: expenseSplits.amount,
      debtorFirstName: users.firstName,
      debtorLastName: users.lastName,
      debtorUsername: users.username,
    })
    .from(expenseSplits)
    .innerJoin(users, eq(users.id, expenseSplits.debtorId))
    .where(inArray(expenseSplits.expenseId, expenseIds));

  const splitsByExpense = new Map<number, typeof splitRows>();
  for (const s of splitRows) {
    const list = splitsByExpense.get(s.expenseId) ?? [];
    list.push(s);
    splitsByExpense.set(s.expenseId, list);
  }

  return NextResponse.json({
    expenses: expenseRows.map((e) => ({
      id: e.id,
      amount: n(e.amount),
      currency: e.currency,
      description: e.description,
      spentAt: e.spentAt,
      receiptFileId: e.receiptFileId,
      payer: {
        userId: e.payerId,
        firstName: e.payerFirstName,
        lastName: e.payerLastName,
        username: e.payerUsername,
      },
      splits: (splitsByExpense.get(e.id) ?? []).map((s) => ({
        debtorId: s.debtorId,
        firstName: s.debtorFirstName,
        lastName: s.debtorLastName,
        username: s.debtorUsername,
        amount: n(s.amount),
      })),
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

  const parsed = expenseInputSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const input = parsed.data;

  const userIds = Array.from(new Set([input.payerId, ...input.splits.map((s) => s.debtorId)]));
  const missing = await findUsersNotInGroup(groupId, userIds);
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `users not in group: ${missing.join(",")}` },
      { status: 400 },
    );
  }

  const [expense] = await db
    .insert(expenses)
    .values({
      groupId,
      payerId: input.payerId,
      amount: input.amount.toFixed(2),
      currency: input.currency,
      description: input.description,
      spentAt: new Date(input.spentAt),
      createdBy: auth.user.id,
      receiptFileId: input.receiptFileId ?? null,
    })
    .returning();

  await db.insert(expenseSplits).values(
    input.splits.map((s) => ({
      expenseId: expense.id,
      debtorId: s.debtorId,
      amount: s.amount.toFixed(2),
      shareType: input.shareType,
      splitValue: s.splitValue != null ? String(s.splitValue) : null,
    })),
  );

  return NextResponse.json({ id: expense.id }, { status: 201 });
});
