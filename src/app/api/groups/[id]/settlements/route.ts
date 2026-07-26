import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { db } from "@/db";
import { expensePayers, expenseSplits, expenses, users } from "@/db/schema";
import { assertGroupMember, findUsersNotInGroup, getAuth } from "@/lib/auth";
import { withAuth } from "@/lib/auth/route";
import { resolveRecordFx } from "@/lib/fx";
import { n } from "@/lib/money";
import { settlementInputSchema } from "@/lib/zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// A settlement is stored as a `type='settlement'` expense: the sole payer is the
// sender (from) and the sole debtor is the receiver (to). The from/to JSON shape
// is reconstructed by joining through expense_payers / expense_splits.
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
      id: expenses.id,
      fromUserId: expensePayers.payerId,
      fromFirstName: fromUser.firstName,
      fromLastName: fromUser.lastName,
      fromUsername: fromUser.username,
      toUserId: expenseSplits.debtorId,
      toFirstName: toUser.firstName,
      toLastName: toUser.lastName,
      toUsername: toUser.username,
      amount: expenses.amount,
      currency: expenses.currency,
      fxRate: expenses.fxRate,
      fxQuote: expenses.fxQuote,
      settledAt: expenses.spentAt,
      createdBy: expenses.createdBy,
    })
    .from(expenses)
    .innerJoin(expensePayers, eq(expensePayers.expenseId, expenses.id))
    .innerJoin(expenseSplits, eq(expenseSplits.expenseId, expenses.id))
    .innerJoin(fromUser, eq(fromUser.id, expensePayers.payerId))
    .innerJoin(toUser, eq(toUser.id, expenseSplits.debtorId))
    .where(and(eq(expenses.groupId, groupId), eq(expenses.type, "settlement")))
    .orderBy(desc(expenses.spentAt));

  return NextResponse.json({
    settlements: rows.map((r) => ({
      id: r.id,
      amount: n(r.amount),
      currency: r.currency,
      fxRate: r.fxRate != null ? n(r.fxRate) : null,
      fxQuote: r.fxQuote,
      settledAt: r.settledAt,
      createdBy: r.createdBy,
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

  const fx = await resolveRecordFx(groupId, input.currency, input.fxRate);
  const amount = input.amount.toFixed(2);

  const id = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(expenses)
      .values({
        groupId,
        type: "settlement",
        amount,
        currency: input.currency,
        description: null,
        spentAt: input.settledAt ? new Date(input.settledAt) : new Date(),
        createdBy: auth.user.id,
        fxRate: fx.fxRate,
        fxQuote: fx.fxQuote,
      })
      .returning({ id: expenses.id });

    await Promise.all([
      tx.insert(expensePayers).values({
        expenseId: row.id,
        payerId: input.fromUserId,
        amount,
      }),
      tx.insert(expenseSplits).values({
        expenseId: row.id,
        debtorId: input.toUserId,
        amount,
        shareType: "exact",
        splitValue: null,
      }),
    ]);

    return row.id;
  });

  return NextResponse.json({ id }, { status: 201 });
});
