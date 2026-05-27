import { NextResponse } from "next/server";
import { desc, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { expenseSplits, expenses, users } from "@/db/schema";
import { assertGroupMember, getAuth } from "@/lib/auth";
import { withAuth } from "@/lib/auth/route";
import { n } from "@/lib/money";

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
      payerFirstName: users.firstName,
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
      payer: {
        id: e.payerId,
        firstName: e.payerFirstName,
        username: e.payerUsername,
      },
      splits: (splitsByExpense.get(e.id) ?? []).map((s) => ({
        debtorId: s.debtorId,
        firstName: s.debtorFirstName,
        username: s.debtorUsername,
        amount: n(s.amount),
      })),
    })),
  });
});
