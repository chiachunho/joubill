import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { db } from "@/db";
import { expensePayers, expenseSplits, expenses, groups, users } from "@/db/schema";
import { assertGroupMember, findUsersNotInGroup, getAuth } from "@/lib/auth";
import { withAuth } from "@/lib/auth/route";
import { fxColumnsFor } from "@/lib/fx";
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
    .where(
      and(
        eq(expenses.id, settlementId),
        eq(expenses.groupId, groupId),
        eq(expenses.type, "settlement"),
      ),
    );

  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });

  return NextResponse.json({
    id: row.id,
    createdBy: row.createdBy,
    amount: n(row.amount),
    currency: row.currency,
    fxRate: row.fxRate != null ? n(row.fxRate) : null,
    fxQuote: row.fxQuote,
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

  const missing = await findUsersNotInGroup(groupId, [input.fromUserId, input.toUserId]);
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `users not in group: ${missing.join(",")}` },
      { status: 400 },
    );
  }

  const [existing] = await db
    .select({
      id: expenses.id,
      currency: expenses.currency,
      fxQuote: expenses.fxQuote,
    })
    .from(expenses)
    .where(
      and(
        eq(expenses.id, settlementId),
        eq(expenses.groupId, groupId),
        eq(expenses.type, "settlement"),
      ),
    );

  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  const [group] = await db
    .select({ defaultCurrency: groups.defaultCurrency })
    .from(groups)
    .where(eq(groups.id, groupId));
  if (!group) return NextResponse.json({ error: "group not found" }, { status: 404 });

  const fx = fxColumnsFor(group.defaultCurrency, input.currency, input.fxRate);
  // Same dormant-pin preservation as the expense PATCH: a blank rate field
  // must not wipe a pin stamped for a different default currency.
  const keepDormantPin =
    input.fxRate == null &&
    existing.fxQuote != null &&
    existing.fxQuote !== group.defaultCurrency &&
    input.currency === existing.currency;

  const amount = input.amount.toFixed(2);

  await db.transaction(async (tx) => {
    await tx
      .update(expenses)
      .set({
        amount,
        currency: input.currency,
        ...(!keepDormantPin && { fxRate: fx.fxRate, fxQuote: fx.fxQuote }),
        spentAt: input.settledAt ? new Date(input.settledAt) : undefined,
        updatedAt: new Date(),
      })
      .where(eq(expenses.id, settlementId));

    // Replace the sole payer/split (from/to may have changed).
    await Promise.all([
      tx.delete(expensePayers).where(eq(expensePayers.expenseId, settlementId)),
      tx.delete(expenseSplits).where(eq(expenseSplits.expenseId, settlementId)),
    ]);
    await Promise.all([
      tx.insert(expensePayers).values({
        expenseId: settlementId,
        payerId: input.fromUserId,
        amount,
      }),
      tx.insert(expenseSplits).values({
        expenseId: settlementId,
        debtorId: input.toUserId,
        amount,
        shareType: "exact",
        splitValue: null,
      }),
    ]);
  });

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
    .select({ id: expenses.id })
    .from(expenses)
    .where(
      and(
        eq(expenses.id, settlementId),
        eq(expenses.groupId, groupId),
        eq(expenses.type, "settlement"),
      ),
    );

  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Any group member can delete a settlement (unchanged from the old behaviour).
  await db.delete(expenses).where(eq(expenses.id, settlementId));
  // expense_payers and expense_splits cascade-deleted via FK.

  return NextResponse.json({ ok: true });
});
