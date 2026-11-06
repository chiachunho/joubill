import { and, eq } from "drizzle-orm";

import { getBot } from "@/bot";
import { db } from "@/db";
import { expensePayers, expenseSplits, expenses } from "@/db/schema";
import { BadRequestError, NotFoundError } from "@/lib/auth/errors";
import { groupTimeZone, resolveRecordFx, spentAtForNow } from "@/lib/fx";
import { logCreated, logUpdated } from "@/lib/record-mutation";
import type { SettlementInput } from "@/lib/zod";

import { assertUsersInGroup, replacePayersAndSplits, resolveUpdateFx } from "./shared";
import type { RecordContext } from "./types";

const apiOf = (ctx: RecordContext) => (ctx.api === undefined ? getBot().api : ctx.api);

// A settlement is a `type='settlement'` expense: the sole payer is the sender
// (from) and the sole debtor is the receiver (to).
const legs = (id: number, input: SettlementInput, amount: string) => ({
  payers: { values: [{ expenseId: id, payerId: input.fromUserId, amount }] },
  splits: {
    values: [
      {
        expenseId: id,
        debtorId: input.toUserId,
        amount,
        shareType: "exact" as const,
        splitValue: null,
      },
    ],
  },
});

async function assertValid(groupId: number, input: SettlementInput): Promise<void> {
  if (input.fromUserId === input.toUserId) throw new BadRequestError("from and to must differ");
  await assertUsersInGroup(groupId, [input.fromUserId, input.toUserId]);
}

/** Creates a settlement from already-validated input; returns its id. */
export async function createSettlement(
  groupId: number,
  input: SettlementInput,
  ctx: RecordContext,
): Promise<{ id: number }> {
  await assertValid(groupId, input);

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
        createdBy: ctx.actor.userId,
        fxRate: fx.fxRate,
        fxQuote: fx.fxQuote,
      })
      .returning({ id: expenses.id });

    const { payers, splits } = legs(row.id, input, amount);
    await Promise.all([
      tx.insert(expensePayers).values(payers.values),
      tx.insert(expenseSplits).values(splits.values),
    ]);
    return row.id;
  });

  await logCreated(apiOf(ctx), id, ctx.actor);
  return { id };
}

/** Replaces a settlement's amount, currency, date and parties. */
export async function updateSettlement(
  groupId: number,
  settlementId: number,
  input: SettlementInput,
  ctx: RecordContext,
): Promise<void> {
  await assertValid(groupId, input);

  const [existing] = await db
    .select({ id: expenses.id, currency: expenses.currency, fxQuote: expenses.fxQuote })
    .from(expenses)
    .where(
      and(
        eq(expenses.id, settlementId),
        eq(expenses.groupId, groupId),
        eq(expenses.type, "settlement"),
      ),
    );
  if (!existing) throw new NotFoundError("not found");

  const fx = await resolveUpdateFx(groupId, input, existing);
  const amount = input.amount.toFixed(2);

  await logUpdated(apiOf(ctx), settlementId, ctx.actor, async (tx) => {
    await tx
      .update(expenses)
      .set({
        amount,
        currency: input.currency,
        ...(fx && { fxRate: fx.fxRate, fxQuote: fx.fxQuote }),
        spentAt: input.settledAt,
        updatedAt: new Date(),
      })
      .where(eq(expenses.id, settlementId));

    // Replace the sole payer/split (from/to may have changed).
    const { payers, splits } = legs(settlementId, input, amount);
    await replacePayersAndSplits(tx, settlementId, payers, splits);
  });
}
