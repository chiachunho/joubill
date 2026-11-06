import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { db } from "@/db";
import { expensePayers, expenseSplits, expenses, users } from "@/db/schema";
import { assertGroupMember, getAuth } from "@/lib/auth";
import { withAuth } from "@/lib/auth/route";
import { n } from "@/lib/money";
import { loadCreatedVia } from "@/lib/record-via";
import { loadLastActivity } from "@/lib/record-history";
import { deleteRecord, updateSettlement } from "@/lib/records";
import { settlementInputSchema } from "@/lib/zod";
import { requireId } from "@/lib/route-params";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; settlementId: string }> };

async function resolveParams(params: Params["params"]) {
  const p = await params;
  const groupId = requireId(p.id, "group id");
  const settlementId = requireId(p.settlementId, "settlement id");
  return { groupId, settlementId };
}

export const GET = withAuth(async (req: Request, { params }: Params) => {
  const auth = await getAuth(req);
  const { groupId, settlementId } = await resolveParams(params);
  await assertGroupMember(auth.user.id, groupId);

  const fromUser = alias(users, "from_user");
  const toUser = alias(users, "to_user");

  const [row] = await db
    .select({
      id: expenses.id,
      fromUserId: expensePayers.payerId,
      fromDisplayName: fromUser.displayName,
      fromFirstName: fromUser.firstName,
      fromLastName: fromUser.lastName,
      fromUsername: fromUser.username,
      toUserId: expenseSplits.debtorId,
      toDisplayName: toUser.displayName,
      toFirstName: toUser.firstName,
      toLastName: toUser.lastName,
      toUsername: toUser.username,
      amount: expenses.amount,
      currency: expenses.currency,
      fxRate: expenses.fxRate,
      fxQuote: expenses.fxQuote,
      settledAt: expenses.spentAt,
      createdBy: expenses.createdBy,
      createdAt: expenses.createdAt,
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

  const [lastActivity, createdVia] = await Promise.all([
    loadLastActivity(settlementId),
    loadCreatedVia([settlementId]),
  ]);

  return NextResponse.json({
    id: row.id,
    createdBy: row.createdBy,
    // The AI assistant it was entered through, shown as 「由 X 透過 Claude 記錄」.
    createdVia: createdVia.get(settlementId) ?? null,
    // Same pair as the expense endpoint: when it was entered, and the most
    // recent edit if there has been one. Both feed the form's attribution lines.
    createdAt: row.createdAt,
    lastActivity: lastActivity && {
      actorId: lastActivity.actor?.userId ?? null,
      at: lastActivity.at,
      via: lastActivity.via,
    },
    amount: n(row.amount),
    currency: row.currency,
    fxRate: row.fxRate != null ? n(row.fxRate) : null,
    fxQuote: row.fxQuote,
    settledAt: row.settledAt,
    from: {
      userId: row.fromUserId,
      displayName: row.fromDisplayName,
      firstName: row.fromFirstName,
      lastName: row.fromLastName,
      username: row.fromUsername,
    },
    to: {
      userId: row.toUserId,
      displayName: row.toDisplayName,
      firstName: row.toFirstName,
      lastName: row.toLastName,
      username: row.toUsername,
    },
  });
});

export const PATCH = withAuth(async (req: Request, { params }: Params) => {
  const auth = await getAuth(req);
  const { groupId, settlementId } = await resolveParams(params);
  await assertGroupMember(auth.user.id, groupId);

  const parsed = settlementInputSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  await updateSettlement(groupId, settlementId, parsed.data, {
    actor: { userId: auth.user.id, source: "app" },
  });
  return NextResponse.json({ ok: true });
});

export const DELETE = withAuth(async (req: Request, { params }: Params) => {
  const auth = await getAuth(req);
  const { groupId, settlementId } = await resolveParams(params);
  await assertGroupMember(auth.user.id, groupId);

  // Any group member can delete a settlement.
  await deleteRecord(groupId, settlementId, "settlement", auth.user, {
    actor: { userId: auth.user.id, source: "app" },
  });
  return NextResponse.json({ ok: true });
});
