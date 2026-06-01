import { NextResponse } from "next/server";
import { desc, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { expenseReceipts, expensePayers, expenseSplits, expenses, users } from "@/db/schema";
import { assertGroupMember, findUsersNotInGroup, getAuth } from "@/lib/auth";
import { withAuth } from "@/lib/auth/route";
import { n } from "@/lib/money";
import { resolveReceiptFileIds } from "@/lib/receipts";
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
      legacyReceiptFileId: expenses.receiptFileId,
    })
    .from(expenses)
    .where(eq(expenses.groupId, groupId))
    .orderBy(desc(expenses.spentAt));

  if (expenseRows.length === 0) {
    return NextResponse.json({ expenses: [] });
  }

  const expenseIds = expenseRows.map((e) => e.id);

  const [payerRows, splitRows, receiptRows] = await Promise.all([
    db
      .select({
        expenseId: expensePayers.expenseId,
        payerId: expensePayers.payerId,
        amount: expensePayers.amount,
        payerFirstName: users.firstName,
        payerLastName: users.lastName,
        payerUsername: users.username,
      })
      .from(expensePayers)
      .innerJoin(users, eq(users.id, expensePayers.payerId))
      .where(inArray(expensePayers.expenseId, expenseIds)),
    db
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
      .where(inArray(expenseSplits.expenseId, expenseIds)),
    db
      .select({ expenseId: expenseReceipts.expenseId, fileId: expenseReceipts.fileId })
      .from(expenseReceipts)
      .where(inArray(expenseReceipts.expenseId, expenseIds))
      .orderBy(expenseReceipts.expenseId, expenseReceipts.position),
  ]);

  const payersByExpense = new Map<number, typeof payerRows>();
  for (const p of payerRows) {
    const list = payersByExpense.get(p.expenseId) ?? [];
    list.push(p);
    payersByExpense.set(p.expenseId, list);
  }

  const splitsByExpense = new Map<number, typeof splitRows>();
  for (const s of splitRows) {
    const list = splitsByExpense.get(s.expenseId) ?? [];
    list.push(s);
    splitsByExpense.set(s.expenseId, list);
  }

  const receiptsByExpense = new Map<number, string[]>();
  for (const r of receiptRows) {
    const list = receiptsByExpense.get(r.expenseId) ?? [];
    list.push(r.fileId);
    receiptsByExpense.set(r.expenseId, list);
  }

  return NextResponse.json({
    expenses: expenseRows.map((e) => ({
      id: e.id,
      amount: n(e.amount),
      currency: e.currency,
      description: e.description,
      spentAt: e.spentAt,
      receiptFileIds: resolveReceiptFileIds(
        receiptsByExpense.get(e.id) ?? [],
        e.legacyReceiptFileId,
      ),
      payers: (payersByExpense.get(e.id) ?? []).map((p) => ({
        userId: p.payerId,
        firstName: p.payerFirstName,
        lastName: p.payerLastName,
        username: p.payerUsername,
        amount: n(p.amount),
      })),
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

  const userIds = Array.from(
    new Set([...input.payers.map((p) => p.payerId), ...input.splits.map((s) => s.debtorId)]),
  );
  const missing = await findUsersNotInGroup(groupId, userIds);
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `users not in group: ${missing.join(",")}` },
      { status: 400 },
    );
  }

  const expense = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(expenses)
      .values({
        groupId,
        amount: input.amount.toFixed(2),
        currency: input.currency,
        description: input.description,
        spentAt: new Date(input.spentAt),
        createdBy: auth.user.id,
      })
      .returning();

    const ops: Promise<unknown>[] = [
      tx.insert(expensePayers).values(
        input.payers.map((p) => ({
          expenseId: row.id,
          payerId: p.payerId,
          amount: p.amount.toFixed(2),
        })),
      ),
      tx.insert(expenseSplits).values(
        input.splits.map((s) => ({
          expenseId: row.id,
          debtorId: s.debtorId,
          amount: s.amount.toFixed(2),
          shareType: input.shareType,
          splitValue: s.splitValue != null ? String(s.splitValue) : null,
        })),
      ),
    ];

    if (input.receiptFileIds && input.receiptFileIds.length > 0) {
      ops.push(
        tx.insert(expenseReceipts).values(
          input.receiptFileIds.map((fileId, i) => ({
            expenseId: row.id,
            fileId,
            position: i,
          })),
        ),
      );
    }

    await Promise.all(ops);
    return row;
  });

  return NextResponse.json({ id: expense.id }, { status: 201 });
});
