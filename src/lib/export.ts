import { and, asc, eq, inArray, type SQL } from "drizzle-orm";

import { db } from "@/db";
import { expensePayers, expenseSplits, expenses, groups, users } from "@/db/schema";

import { buildCsv, formatLegs, formatUtcMinute, exportFilename, type CsvCell } from "./csv";
import { fxDateKey, loadGroupRateOverrides, resolveRate } from "./fx";
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

/** Significant digits kept on 匯率: a fixed 4 dp would turn a VND→TWD 0.00123 into 0.0012. */
const RATE_SIG = 6;

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
    Number(r.rate.toPrecision(RATE_SIG)),
    formatLegs(r.payers),
    formatLegs(r.splits),
    r.createdByName,
    formatUtcMinute(r.createdAt),
  ]);
  return buildCsv(EXPORT_HEADER, rows);
}

/** One record as both exports read it: ids (beancount) and names (CSV) are both on hand. */
export type LoadedRecord = {
  id: number;
  type: "expense" | "settlement";
  spentAt: Date;
  createdAt: Date;
  description: string | null;
  amount: number;
  currency: string;
  /** Rate to the group's default currency (`resolveRate`); 1 when `rates: false`. */
  rate: number;
  createdBy: number;
  payers: { userId: number; amount: number }[];
  splits: { userId: number; amount: number }[];
};

export type LoadedGroupRecords = {
  group: typeof groups.$inferSelect;
  records: LoadedRecord[];
  /** Display name per user id, for every person the records mention. */
  name: (userId: number) => string;
};

/**
 * The group's records, oldest first, with their legs and names, shared by the CSV
 * and beancount exports so the two can't load records differently. `where` narrows
 * the rows (the beancount range); `rates: false` skips FX for a count-only caller.
 * Rates come from `resolveRate`, the same pinned > group > market chain
 * `computeGroupBalances` uses, so converted figures add up to /balance.
 */
export async function loadGroupRecords(
  groupId: number,
  { where, rates = true }: { where?: SQL; rates?: boolean } = {},
): Promise<LoadedGroupRecords | null> {
  const [group] = await db.select().from(groups).where(eq(groups.id, groupId));
  if (!group) return null;
  const quote = group.defaultCurrency;

  const rows = await db
    .select()
    .from(expenses)
    .where(where ? and(eq(expenses.groupId, groupId), where) : eq(expenses.groupId, groupId))
    .orderBy(asc(expenses.spentAt), asc(expenses.id));
  const ids = rows.map((r) => r.id);

  const [payerRows, splitRows, overrides] = await Promise.all([
    ids.length
      ? db.select().from(expensePayers).where(inArray(expensePayers.expenseId, ids))
      : Promise.resolve([]),
    ids.length
      ? db.select().from(expenseSplits).where(inArray(expenseSplits.expenseId, ids))
      : Promise.resolve([]),
    rates ? loadGroupRateOverrides(groupId) : Promise.resolve(undefined),
  ]);

  const userIds = new Set<number>(rows.map((r) => r.createdBy));
  for (const p of payerRows) userIds.add(p.payerId);
  for (const s of splitRows) userIds.add(s.debtorId);
  const profiles = userIds.size
    ? await db
        .select({
          id: users.id,
          displayName: users.displayName,
          firstName: users.firstName,
          lastName: users.lastName,
          username: users.username,
        })
        .from(users)
        .where(inArray(users.id, [...userIds]))
    : [];
  const nameOf = new Map(profiles.map((p) => [p.id, labelUser(p)]));
  const name = (id: number) => nameOf.get(id) ?? "?";

  const payersBy = new Map<number, { userId: number; amount: number }[]>();
  for (const p of payerRows) {
    const list = payersBy.get(p.expenseId) ?? [];
    list.push({ userId: p.payerId, amount: n(p.amount) });
    payersBy.set(p.expenseId, list);
  }
  const splitsBy = new Map<number, { userId: number; amount: number }[]>();
  for (const s of splitRows) {
    const list = splitsBy.get(s.expenseId) ?? [];
    list.push({ userId: s.debtorId, amount: n(s.amount) });
    splitsBy.set(s.expenseId, list);
  }

  // Rows share (currency, pin, day) far more often than not, so resolve each distinct
  // combination once and all of them concurrently instead of one round trip per row.
  const rateCache = new Map<string, Promise<number>>();
  const rateOf = (r: (typeof rows)[number]) => {
    const key = [r.currency, r.fxRate, r.fxQuote, fxDateKey(r.spentAt)].join("|");
    let rate = rateCache.get(key);
    if (!rate) {
      rate = resolveRate(r, quote, r.spentAt, overrides);
      rateCache.set(key, rate);
    }
    return rate;
  };
  const resolved = rates ? await Promise.all(rows.map(rateOf)) : rows.map(() => 1);

  const records: LoadedRecord[] = rows.map((r, i) => ({
    id: r.id,
    type: r.type === "settlement" ? "settlement" : "expense",
    spentAt: r.spentAt,
    createdAt: r.createdAt,
    description: r.description,
    amount: n(r.amount),
    currency: r.currency,
    rate: resolved[i],
    createdBy: r.createdBy,
    payers: payersBy.get(r.id) ?? [],
    splits: splitsBy.get(r.id) ?? [],
  }));

  return { group, records, name };
}

/** Every record of the group, oldest first, rendered as CSV. */
export async function buildGroupExport(
  groupId: number,
  now: Date = new Date(),
): Promise<{ filename: string; csv: string } | null> {
  const loaded = await loadGroupRecords(groupId);
  if (!loaded) return null;
  const { group, records, name } = loaded;
  const legs = (list: { userId: number; amount: number }[]) =>
    list.map((l) => ({ name: name(l.userId), amount: l.amount }));

  const rows: ExportRecord[] = records.map((r) => ({
    type: r.type,
    spentAt: r.spentAt,
    description: r.description,
    amount: r.amount,
    currency: r.currency,
    rate: r.rate,
    payers: legs(r.payers),
    splits: legs(r.splits),
    createdByName: name(r.createdBy),
    createdAt: r.createdAt,
  }));

  return {
    filename: exportFilename(group.title, now),
    csv: exportRecordsToCsv(rows, group.defaultCurrency),
  };
}
