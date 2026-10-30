import { and, eq, inArray, or, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  expensePayers,
  expenses,
  expenseSplits,
  groupExchangeRates,
  groupInvites,
  groupMembers,
  recordAuditLog,
  userBeancountConfigs,
  users,
} from "@/db/schema";
import { lockGroupMemberNames } from "@/lib/member-name-lock";
import {
  findSelfSettlements,
  planMerge,
  rekeyPersonAccounts,
  summariseMerge,
  validateMerge,
  type MergeCheck,
  type MergeExpenseMeta,
  type MergePlan,
  type MergePayerRow,
  type MergeSplitRow,
  type MergeSummary,
} from "@/lib/member-merge";
import { labelUser } from "@/lib/label";
import { n } from "@/lib/money";

type Executor = Pick<typeof db, "select" | "selectDistinct">;
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Everything the planner needs: the placeholder's expenses, with all their payer and split rows. */
export async function loadMergeData(
  ex: Executor,
  groupId: number,
  fromId: number,
  { lock = false }: { lock?: boolean } = {},
) {
  const touching = await ex
    .selectDistinct({ id: expenses.id })
    .from(expenses)
    .leftJoin(expensePayers, eq(expensePayers.expenseId, expenses.id))
    .leftJoin(expenseSplits, eq(expenseSplits.expenseId, expenses.id))
    .where(
      and(
        eq(expenses.groupId, groupId),
        or(eq(expensePayers.payerId, fromId), eq(expenseSplits.debtorId, fromId)),
      ),
    );
  const ids = touching.map((r) => r.id);
  if (ids.length === 0) {
    return {
      expenses: [] as MergeExpenseMeta[],
      payers: [] as MergePayerRow[],
      splits: [] as MergeSplitRow[],
    };
  }

  if (lock) {
    // Same lock `logUpdated` takes, and taken *before* the legs are read: an edit replaces
    // payers and splits wholesale, so legs read ahead of the lock could name rows already gone.
    await ex
      .select({ id: expenses.id })
      .from(expenses)
      .where(inArray(expenses.id, ids))
      .for("update");
  }

  const [metaRows, payerRows, splitRows] = await Promise.all([
    ex
      .select({ id: expenses.id, type: expenses.type, currency: expenses.currency })
      .from(expenses)
      .where(inArray(expenses.id, ids)),
    ex.select().from(expensePayers).where(inArray(expensePayers.expenseId, ids)),
    ex.select().from(expenseSplits).where(inArray(expenseSplits.expenseId, ids)),
  ]);

  return {
    expenses: metaRows,
    payers: payerRows.map((p) => ({
      id: p.id,
      expenseId: p.expenseId,
      payerId: p.payerId,
      amount: n(p.amount),
    })),
    splits: splitRows.map((s) => ({
      id: s.id,
      expenseId: s.expenseId,
      debtorId: s.debtorId,
      amount: n(s.amount),
      shareType: s.shareType,
      splitValue: s.splitValue == null ? null : n(s.splitValue),
    })),
  };
}

/**
 * Writes a `planMerge` result: payer and split rows of `from` become `toUserId`'s. Shared by
 * claiming a placeholder and by merging two accounts (`account-merge-db.ts`).
 */
export async function applyMergePlan(tx: Tx, plan: MergePlan, toUserId: number): Promise<void> {
  // Each list below is one statement, not one per row: a placeholder with hundreds of
  // records would otherwise hold the group lock for hundreds of round trips.
  if (plan.payerRepoint.length > 0) {
    await tx
      .update(expensePayers)
      .set({ payerId: toUserId })
      .where(inArray(expensePayers.id, plan.payerRepoint));
  }
  if (plan.payerMerge.length > 0) {
    await tx.delete(expensePayers).where(
      inArray(
        expensePayers.id,
        plan.payerMerge.map((m) => m.deleteId),
      ),
    );
    const values = sql.join(
      plan.payerMerge.map((m) => sql`(${m.keepId}::int, ${m.amount.toFixed(2)}::numeric)`),
      sql`, `,
    );
    await tx.execute(sql`
      update expense_payers as p set amount = v.amount
      from (values ${values}) as v(id, amount)
      where p.id = v.id`);
  }

  if (plan.splitDelete.length > 0) {
    await tx.delete(expenseSplits).where(inArray(expenseSplits.id, plan.splitDelete));
  }
  const repoints = plan.splitUpdates.filter((u) => u.debtorId !== undefined);
  if (repoints.length > 0) {
    await tx
      .update(expenseSplits)
      .set({ debtorId: toUserId })
      .where(
        inArray(
          expenseSplits.id,
          repoints.map((u) => u.id),
        ),
      );
  }
  // Merged rows carry their own summed amount; the rest only change kind.
  const merged = plan.splitUpdates.filter((u) => u.amount !== undefined);
  if (merged.length > 0) {
    const values = sql.join(
      merged.map(
        (u) =>
          sql`(${u.id}::int, ${u.amount!.toFixed(2)}::numeric, ${u.shareType}::text, ${
            u.splitValue == null ? null : String(u.splitValue)
          }::numeric)`,
      ),
      sql`, `,
    );
    await tx.execute(sql`
      update expense_splits as s
      set amount = v.amount, share_type = v.share_type, split_value = v.split_value
      from (values ${values}) as v(id, amount, share_type, split_value)
      where s.id = v.id`);
  }
  const retyped = plan.splitUpdates.filter(
    (u) => u.debtorId === undefined && u.amount === undefined,
  );
  if (retyped.length > 0) {
    const values = sql.join(
      retyped.map(
        (u) =>
          sql`(${u.id}::int, ${u.shareType}::text, ${
            u.splitValue == null ? null : String(u.splitValue)
          }::numeric)`,
      ),
      sql`, `,
    );
    await tx.execute(sql`
      update expense_splits as s
      set share_type = v.share_type, split_value = v.split_value
      from (values ${values}) as v(id, share_type, split_value)
      where s.id = v.id`);
  }
}

/**
 * Repoints the `users.id` columns that do not cascade, so deleting `fromUserId` afterwards
 * can't fail on them. Shared by claiming a placeholder and merging two accounts: a new
 * non-cascading reference to `users.id` goes here, once.
 */
export async function repointUserReferences(
  tx: Tx,
  fromUserId: number,
  toUserId: number,
): Promise<void> {
  await tx.update(expenses).set({ createdBy: toUserId }).where(eq(expenses.createdBy, fromUserId));
  await tx
    .update(recordAuditLog)
    .set({ actorId: toUserId })
    .where(eq(recordAuditLog.actorId, fromUserId));
  await tx
    .update(groupExchangeRates)
    .set({ createdBy: toUserId })
    .where(eq(groupExchangeRates.createdBy, fromUserId));
  await tx
    .update(groupInvites)
    .set({ createdBy: toUserId })
    .where(eq(groupInvites.createdBy, fromUserId));
}

async function loadPair(ex: Executor, fromId: number, toId: number) {
  const rows = await ex
    .select({
      id: users.id,
      placeholderGroupId: users.placeholderGroupId,
      firstName: users.firstName,
      lastName: users.lastName,
      username: users.username,
    })
    .from(users)
    .where(inArray(users.id, [fromId, toId]));
  return {
    from: rows.find((r) => r.id === fromId),
    to: rows.find((r) => r.id === toId),
  };
}

/** What a merge would take, for the confirm dialog. Writes nothing. */
export async function previewMerge(
  groupId: number,
  fromId: number,
  toId: number,
): Promise<{ check: MergeCheck; summary: MergeSummary | null }> {
  const { from, to } = await loadPair(db, fromId, toId);
  const check = validateMerge(groupId, from, to);
  if (!check.ok) return { check, summary: null };
  const data = await loadMergeData(db, groupId, fromId);
  return { check, summary: summariseMerge({ fromId, toId, ...data }) };
}

export type MergeResult =
  | {
      ok: true;
      placeholderName: string;
      claimerName: string;
      recordIds: number[];
      /** Settlements between the two people that were kept (`keep`) or are about to be deleted (`delete`). */
      selfSettlementIds: number[];
    }
  | { ok: false; status: 400 | 403 | 404; error: string };

/**
 * Fold `fromUserId` (this group's placeholder) into `toUserId` (a real account).
 * Runs inside the caller's transaction; log the audit row after it commits.
 *
 * Settlements between the two people become "A → A". They are returned, not deleted here: deleting
 * a record has to go through `logDeleted` (audit row + chat tombstone), which opens its own
 * transaction, so the caller does it after this one commits when the merger chose `delete`.
 */
export async function mergeUserInto(
  tx: Tx,
  groupId: number,
  fromUserId: number,
  toUserId: number,
): Promise<MergeResult> {
  await lockGroupMemberNames(tx, groupId);

  const { from, to } = await loadPair(tx, fromUserId, toUserId);
  const check = validateMerge(groupId, from, to);
  if (!check.ok) return check;

  const data = await loadMergeData(tx, groupId, fromUserId, { lock: true });
  const plan = planMerge({ fromId: fromUserId, toId: toUserId, ...data });

  await applyMergePlan(tx, plan, toUserId);

  // The real account keeps its own membership row; otherwise it takes the placeholder's place.
  await tx
    .insert(groupMembers)
    .values({ groupId, userId: toUserId, status: "active" })
    .onConflictDoNothing();
  await tx
    .delete(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, fromUserId)));

  const configs = await tx
    .select({ id: userBeancountConfigs.id, personAccounts: userBeancountConfigs.personAccounts })
    .from(userBeancountConfigs)
    .where(eq(userBeancountConfigs.groupId, groupId));
  for (const c of configs) {
    const next = rekeyPersonAccounts(c.personAccounts, fromUserId, toUserId);
    if (next !== c.personAccounts) {
      await tx
        .update(userBeancountConfigs)
        .set({ personAccounts: next })
        .where(eq(userBeancountConfigs.id, c.id));
    }
  }

  // None of these can name a placeholder today, but none cascades, so a stray one would
  // block the delete below. Repointing is cheap insurance.
  await repointUserReferences(tx, fromUserId, toUserId);

  await tx
    .delete(users)
    .where(and(eq(users.id, fromUserId), eq(users.placeholderGroupId, groupId)));

  return {
    ok: true,
    placeholderName: labelUser(from!),
    claimerName: labelUser(to!),
    recordIds: plan.recordIds,
    selfSettlementIds: findSelfSettlements({ fromId: fromUserId, toId: toUserId, ...data }),
  };
}
