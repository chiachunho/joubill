import { NextResponse } from "next/server";

import { getBot } from "@/bot";
import { db } from "@/db";
import { expensePayers, expenseSplits, expenses } from "@/db/schema";
import { assertGroupMember, findUsersNotInGroup, getAuth } from "@/lib/auth";
import { withAuth } from "@/lib/auth/route";
import { groupTimeZone, resolveRecordFx, spentAtForNow } from "@/lib/fx";
import { logCreated } from "@/lib/record-mutation";
import { settlementInputSchema } from "@/lib/zod";
import { requireId } from "@/lib/route-params";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// A settlement is stored as a `type='settlement'` expense: the sole payer is the
// sender (from) and the sole debtor is the receiver (to). There is no list GET
// here — settlements appear in the main list at `GET …/expenses`.
export const POST = withAuth(async (req: Request, { params }: Params) => {
  const auth = await getAuth(req);
  const groupId = requireId((await params).id, "group id");
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
  const day = input.settledAt ?? spentAtForNow(await groupTimeZone(groupId));
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
        spentAt: day,
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

  await logCreated(getBot().api, id, { userId: auth.user.id, source: "app" });

  return NextResponse.json({ id }, { status: 201 });
});
