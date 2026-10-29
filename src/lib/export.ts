import { asc, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { expensePayers, expenseSplits, expenses, groups, users } from "@/db/schema";

import { buildCsv, formatLegs, formatUtcMinute, exportFilename, type CsvCell } from "./csv";
import { loadGroupRateOverrides, resolveRate } from "./fx";
import { labelUser } from "./label";
import { n } from "./money";

export const EXPORT_HEADER = [
  "日期 (UTC)",
  "類型",
  "說明",
  "金額",
  "幣別",
  "換算金額",
  "換算幣別",
  "匯率",
  "付款人",
  "分攤",
  "記錄者",
  "建立時間 (UTC)",
] as const;

/** Decimals kept on 換算金額 and 匯率, so column sums reconcile with /balance (which rounds once, at the end). */
const FX_DP = 4;

export type ExportRecord = {
  type: string;
  spentAt: Date;
  description: string | null;
  amount: number;
  currency: string;
  /** Rate to the group's default currency, as resolved by `resolveRate`. */
  rate: number;
  payers: { name: string; amount: number }[];
  splits: { name: string; amount: number }[];
  createdByName: string;
  createdAt: Date;
};

function fixed(value: number): number {
  return Number(value.toFixed(FX_DP));
}

/** Pure: records → CSV text. */
export function exportRecordsToCsv(records: readonly ExportRecord[], quote: string): string {
  const rows: CsvCell[][] = records.map((r) => [
    formatUtcMinute(r.spentAt),
    r.type === "settlement" ? "還款" : "支出",
    r.description ?? "",
    r.amount,
    r.currency,
    fixed(r.amount * r.rate),
    quote,
    fixed(r.rate),
    formatLegs(r.payers),
    formatLegs(r.splits),
    r.createdByName,
    formatUtcMinute(r.createdAt),
  ]);
  return buildCsv(EXPORT_HEADER, rows);
}

/**
 * Every record of the group, oldest first, rendered as CSV. Rates come from
 * `resolveRate`, the same pinned > group > market chain `computeGroupBalances`
 * uses, so the 換算金額 column adds up to the same figures as /balance.
 */
export async function buildGroupExport(
  groupId: number,
  now: Date = new Date(),
): Promise<{ filename: string; csv: string } | null> {
  const [group] = await db.select().from(groups).where(eq(groups.id, groupId));
  if (!group) return null;
  const quote = group.defaultCurrency;

  const rows = await db
    .select()
    .from(expenses)
    .where(eq(expenses.groupId, groupId))
    .orderBy(asc(expenses.spentAt), asc(expenses.id));
  const ids = rows.map((r) => r.id);

  const [payerRows, splitRows, overrides] = await Promise.all([
    ids.length
      ? db.select().from(expensePayers).where(inArray(expensePayers.expenseId, ids))
      : Promise.resolve([]),
    ids.length
      ? db.select().from(expenseSplits).where(inArray(expenseSplits.expenseId, ids))
      : Promise.resolve([]),
    loadGroupRateOverrides(groupId),
  ]);

  const userIds = new Set<number>(rows.map((r) => r.createdBy));
  for (const p of payerRows) userIds.add(p.payerId);
  for (const s of splitRows) userIds.add(s.debtorId);
  const profiles = userIds.size
    ? await db
        .select({
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
          username: users.username,
        })
        .from(users)
        .where(inArray(users.id, [...userIds]))
    : [];
  const nameOf = new Map(
    profiles.map((p) => [
      p.id,
      labelUser({ firstName: p.firstName, lastName: p.lastName, username: p.username }),
    ]),
  );
  const name = (id: number) => nameOf.get(id) ?? "?";

  const payersBy = new Map<number, { name: string; amount: number }[]>();
  for (const p of payerRows) {
    const list = payersBy.get(p.expenseId) ?? [];
    list.push({ name: name(p.payerId), amount: n(p.amount) });
    payersBy.set(p.expenseId, list);
  }
  const splitsBy = new Map<number, { name: string; amount: number }[]>();
  for (const s of splitRows) {
    const list = splitsBy.get(s.expenseId) ?? [];
    list.push({ name: name(s.debtorId), amount: n(s.amount) });
    splitsBy.set(s.expenseId, list);
  }

  const records: ExportRecord[] = [];
  for (const r of rows) {
    records.push({
      type: r.type,
      spentAt: r.spentAt,
      description: r.description,
      amount: n(r.amount),
      currency: r.currency,
      rate: await resolveRate(r, quote, r.spentAt, overrides),
      payers: payersBy.get(r.id) ?? [],
      splits: splitsBy.get(r.id) ?? [],
      createdByName: name(r.createdBy),
      createdAt: r.createdAt,
    });
  }

  return {
    filename: exportFilename(group.title, now),
    csv: exportRecordsToCsv(records, quote),
  };
}
