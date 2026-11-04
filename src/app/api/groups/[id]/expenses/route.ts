import { NextResponse } from "next/server";
import { and, count, desc, eq, inArray, sql } from "drizzle-orm";

import { getBot } from "@/bot";
import { db } from "@/db";
import { expenseReceipts, expensePayers, expenseSplits, expenses, users } from "@/db/schema";
import { EXPENSES_PAGE_SIZE, encodeExpenseCursor, parseExpenseCursor } from "@/lib/expense-cursor";
import { assertGroupMember, findUsersNotInGroup, getAuth } from "@/lib/auth";
import { withAuth } from "@/lib/auth/route";
import { resolveRecordFx } from "@/lib/fx";
import { n } from "@/lib/money";
import { logCreated } from "@/lib/record-mutation";
import { resolveReceiptFileIds } from "@/lib/receipts";
import { expenseInputSchema } from "@/lib/zod";
import { requireId } from "@/lib/route-params";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export const GET = withAuth(async (req: Request, { params }: Params) => {
  const auth = await getAuth(req);
  const groupId = requireId((await params).id, "group id");
  await assertGroupMember(auth.user.id, groupId);

  const rawCursor = new URL(req.url).searchParams.get("cursor");
  const cursor = rawCursor != null ? parseExpenseCursor(rawCursor) : null;
  if (rawCursor != null && !cursor) {
    return NextResponse.json({ error: "invalid cursor" }, { status: 400 });
  }

  // The total covers every record in the group (expenses and settlements, as the
  // list does) and is only needed once, so later pages skip the count.
  const totalQuery = cursor
    ? null
    : db.select({ value: count() }).from(expenses).where(eq(expenses.groupId, groupId));

  const pageQuery = db
    .select({
      id: expenses.id,
      type: expenses.type,
      amount: expenses.amount,
      currency: expenses.currency,
      description: expenses.description,
      spentAt: expenses.spentAt,
      createdBy: expenses.createdBy,
      legacyReceiptFileId: expenses.receiptFileId,
      fxRate: expenses.fxRate,
      fxQuote: expenses.fxQuote,
      // Full microsecond precision, which a JS Date would round off.
      spentAtCursor: sql<string>`to_char(${expenses.spentAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
    })
    .from(expenses)
    .where(
      and(
        eq(expenses.groupId, groupId),
        cursor
          ? sql`(${expenses.spentAt}, ${expenses.id}) < (${cursor.spentAt}::timestamptz, ${cursor.id})`
          : undefined,
      ),
    )
    .orderBy(desc(expenses.spentAt), desc(expenses.id))
    .limit(EXPENSES_PAGE_SIZE + 1);

  // Together, so a failure in either is handled here rather than left dangling.
  const [totalRows, fetched] = await Promise.all([totalQuery, pageQuery]);
  const total = totalRows ? totalRows[0].value : null;

  // One extra row says whether another page exists.
  const expenseRows = fetched.slice(0, EXPENSES_PAGE_SIZE);
  if (expenseRows.length === 0) {
    return NextResponse.json({ expenses: [], nextCursor: null, total });
  }
  const last = expenseRows[expenseRows.length - 1];
  const nextCursor =
    fetched.length > EXPENSES_PAGE_SIZE
      ? encodeExpenseCursor({ spentAt: last.spentAtCursor, id: last.id })
      : null;

  const expenseIds = expenseRows.map((e) => e.id);

  const [payerRows, splitRows, receiptRows] = await Promise.all([
    db
      .select({
        expenseId: expensePayers.expenseId,
        payerId: expensePayers.payerId,
        amount: expensePayers.amount,
        payerDisplayName: users.displayName,
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
        debtorDisplayName: users.displayName,
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
    nextCursor,
    total,
    expenses: expenseRows.map((e) => ({
      id: e.id,
      type: e.type,
      amount: n(e.amount),
      currency: e.currency,
      description: e.description,
      spentAt: e.spentAt,
      fxRate: e.fxRate != null ? n(e.fxRate) : null,
      fxQuote: e.fxQuote,
      receiptFileIds: resolveReceiptFileIds(
        receiptsByExpense.get(e.id) ?? [],
        e.legacyReceiptFileId,
      ),
      payers: (payersByExpense.get(e.id) ?? []).map((p) => ({
        userId: p.payerId,
        displayName: p.payerDisplayName,
        firstName: p.payerFirstName,
        lastName: p.payerLastName,
        username: p.payerUsername,
        amount: n(p.amount),
      })),
      splits: (splitsByExpense.get(e.id) ?? []).map((s) => ({
        debtorId: s.debtorId,
        displayName: s.debtorDisplayName,
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
  const groupId = requireId((await params).id, "group id");
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

  const fx = await resolveRecordFx(groupId, input.currency, input.fxRate);

  const expense = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(expenses)
      .values({
        groupId,
        type: "expense",
        amount: input.amount.toFixed(2),
        currency: input.currency,
        description: input.description,
        spentAt: new Date(input.spentAt),
        createdBy: auth.user.id,
        fxRate: fx.fxRate,
        fxQuote: fx.fxQuote,
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

  await logCreated(getBot().api, expense.id, { userId: auth.user.id, source: "app" });

  return NextResponse.json({ id: expense.id }, { status: 201 });
});
