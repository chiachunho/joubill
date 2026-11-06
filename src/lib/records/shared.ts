import { eq } from "drizzle-orm";

import { db } from "@/db";
import { expensePayers, expenseSplits, groups } from "@/db/schema";
import { findUsersNotInGroup } from "@/lib/auth";
import { BadRequestError, NotFoundError } from "@/lib/auth/errors";
import { fxColumnsFor } from "@/lib/fx";
import type { Tx } from "@/lib/record-mutation";

/** Throws a 400 naming every user that is not a member of the group. */
export async function assertUsersInGroup(groupId: number, userIds: number[]): Promise<void> {
  const missing = await findUsersNotInGroup(groupId, Array.from(new Set(userIds)));
  if (missing.length > 0) throw new BadRequestError(`users not in group: ${missing.join(",")}`);
}

/**
 * Whether an edit that leaves the rate field blank must keep the stored pin.
 *
 * A blank rate means "automatic", which a dormant pin (stamped for a different
 * default currency) doesn't interfere with, so it is kept and can revive if the
 * default reverts, instead of being wiped by an unrelated edit.
 */
export function keepsDormantPin(args: {
  inputFxRate: number | null | undefined;
  inputCurrency: string;
  existing: { currency: string; fxQuote: string | null };
  defaultCurrency: string;
}): boolean {
  return (
    args.inputFxRate == null &&
    args.existing.fxQuote != null &&
    args.existing.fxQuote !== args.defaultCurrency &&
    args.inputCurrency === args.existing.currency
  );
}

/** The fx columns an edit writes (`null` = leave the stored pin alone). */
export async function resolveUpdateFx(
  groupId: number,
  input: { currency: string; fxRate?: number | null },
  existing: { currency: string; fxQuote: string | null },
): Promise<{ fxRate: string | null; fxQuote: string | null } | null> {
  const [group] = await db
    .select({ defaultCurrency: groups.defaultCurrency })
    .from(groups)
    .where(eq(groups.id, groupId));
  if (!group) throw new NotFoundError("group not found");
  const keep = keepsDormantPin({
    inputFxRate: input.fxRate,
    inputCurrency: input.currency,
    existing,
    defaultCurrency: group.defaultCurrency,
  });
  return keep ? null : fxColumnsFor(group.defaultCurrency, input.currency, input.fxRate);
}

/** Replaces a record's payers and splits wholesale. */
export async function replacePayersAndSplits(
  tx: Tx,
  recordId: number,
  payers: { values: (typeof expensePayers.$inferInsert)[] },
  splits: { values: (typeof expenseSplits.$inferInsert)[] },
): Promise<void> {
  await Promise.all([
    tx.delete(expensePayers).where(eq(expensePayers.expenseId, recordId)),
    tx.delete(expenseSplits).where(eq(expenseSplits.expenseId, recordId)),
  ]);
  await Promise.all([
    tx.insert(expensePayers).values(payers.values),
    tx.insert(expenseSplits).values(splits.values),
  ]);
}
