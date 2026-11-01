/**
 * Render splitbill records as beancount transactions, from the **personal-ledger
 * perspective** of one user (U), for the group's beancount export (issue #117).
 *
 * Three accounts, configurable per (user, group) (see CLAUDE.md, "Beancount 匯出"):
 * - expenses (`Expenses:Uncategorized`) — U's own share of consumption.
 * - cash (`Assets:Cash`)                — cash U actually moved.
 * - event (`Assets:Receivable:<group>`) — everything between U and the rest of the
 *   group, in one account. Its balance is U's net balance in the group, the same
 *   number the app's balance page shows.
 *
 * One event account rather than one receivable per person, on purpose: settle-up
 * suggestions minimise transfers, so they routinely have U pay someone U never owed
 * directly. Per-person receivables would then never return to zero even after U is
 * fully settled; a single account does.
 *
 * The transaction always balances in the record's own currency. When `fx` is
 * supplied, every posting also carries an `@ <rate> <quote>` price so it balances
 * in the group's default currency too.
 *
 * Pure (no DB, no fetch): the caller resolves rates and accounts.
 */

import { formatUtcMinute } from "@/lib/csv";
import { BEANCOUNT_LEAF_RE } from "@/lib/zod";

export type BeancountParty = { userId: number; amount: number };

export type BeancountRecord = {
  /** The record id, written as `splitbill_id` metadata so a re-import can be deduplicated. */
  id: number;
  type: "expense" | "settlement";
  amount: number;
  currency: string;
  description: string | null;
  /** ISO timestamp; only the calendar date is used. */
  spentAt: string;
  payers: BeancountParty[];
  splits: BeancountParty[];
};

/**
 * FX context for converting into the group default currency:
 * - `null` / `undefined` — no conversion (record is already in the default).
 * - `{ quote, rate }` — annotate every posting with `@ rate quote`.
 */
export type BeancountFx = { quote: string; rate: number } | null | undefined;

export type BeancountAccounts = {
  expenses: string;
  cash: string;
  event: string;
};

/** Defaults for the two accounts that don't depend on the group. */
export const DEFAULT_EXPENSES_ACCOUNT = "Expenses:Uncategorized";
export const DEFAULT_CASH_ACCOUNT = "Assets:Cash";
/** The event account is `<prefix>:<leaf from the group title>`. */
export const DEFAULT_EVENT_PREFIX = "Assets:Receivable";

/**
 * A valid account leaf from a group title: letters and digits only (any script,
 * since the settings form accepts e.g. `Assets:Flow:現金`), first letter upper-cased.
 * Falls back to `Group<id>` when nothing usable is left (a title of only emoji).
 */
export function eventAccountLeaf(title: string, groupId: number): string {
  const cleaned = title.replace(/[^\p{L}\p{N}]/gu, "");
  const leaf = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  return BEANCOUNT_LEAF_RE.test(leaf) ? leaf : `Group${groupId}`;
}

export function defaultEventAccount(title: string, groupId: number): string {
  return `${DEFAULT_EVENT_PREFIX}:${eventAccountLeaf(title, groupId)}`;
}

/** A saved config row (any column may be unset) resolved against the defaults. */
export function resolveBeancountAccounts(
  row: {
    expensesAccount?: string | null;
    cashAccount?: string | null;
    eventAccount?: string | null;
  } | null,
  group: { id: number; title: string },
): BeancountAccounts {
  return {
    expenses: row?.expensesAccount || DEFAULT_EXPENSES_ACCOUNT,
    cash: row?.cashAccount || DEFAULT_CASH_ACCOUNT,
    event: row?.eventAccount || defaultEventAccount(group.title, group.id),
  };
}

type Posting = { account: string; amount: number };

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function sumFor(parties: BeancountParty[], userId: number): number {
  return parties.reduce((s, p) => (p.userId === userId ? s + p.amount : s), 0);
}

/**
 * U's postings for a record, or `null` when the record doesn't touch U's ledger
 * (U neither paid nor shares an expense; a settlement between two other people,
 * or one from U to U left behind by an account merge).
 */
export function recordPostings(
  record: BeancountRecord,
  userId: number,
  accounts: BeancountAccounts,
): Posting[] | null {
  if (record.type === "settlement") {
    const fromId = record.payers[0]?.userId;
    const toId = record.splits[0]?.userId;
    if (fromId === toId) return null;
    const amount = round2(record.amount);
    // U repays: the group owes U less (event up), cash goes out.
    if (userId === fromId) {
      return [
        { account: accounts.event, amount },
        { account: accounts.cash, amount: -amount },
      ];
    }
    // U is repaid: cash comes in, the group owes U less.
    if (userId === toId) {
      return [
        { account: accounts.cash, amount },
        { account: accounts.event, amount: -amount },
      ];
    }
    return null;
  }

  const paid = round2(sumFor(record.payers, userId));
  const owed = round2(sumFor(record.splits, userId));
  if (paid === 0 && owed === 0) return null;
  // The event leg is the difference of the two rounded legs, so the
  // transaction balances exactly and no rounding residual needs folding.
  const event = round2(paid - owed);
  const postings: Posting[] = [];
  if (owed !== 0) postings.push({ account: accounts.expenses, amount: owed });
  if (paid !== 0) postings.push({ account: accounts.cash, amount: -paid });
  if (event !== 0) postings.push({ account: accounts.event, amount: event });
  return postings;
}

function escapeString(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/[\r\n]+/g, " ")
    .trim();
}

/** The UTC calendar date of a timestamp, which is what the CSV export uses too. */
export function beancountDate(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

/** Format an FX rate compactly (trim trailing zeros, no scientific notation). */
function formatRate(rate: number): string {
  let s = rate.toFixed(10);
  if (s.includes(".")) s = s.replace(/0+$/, "").replace(/\.$/, "");
  return s;
}

/**
 * Render one record as a beancount transaction from `userId`'s perspective, or
 * `null` when it doesn't touch their ledger (see {@link recordPostings}).
 * `narration` overrides the record's description (the export names the two
 * people of a settlement, which has no description of its own).
 */
export function recordToBeancount(
  record: BeancountRecord,
  userId: number,
  accounts: BeancountAccounts,
  fx?: BeancountFx,
  narration?: string,
): string | null {
  const postings = recordPostings(record, userId, accounts);
  if (!postings) return null;

  const text = narration ?? record.description ?? "";
  const lines = [
    `${beancountDate(record.spentAt)} * "${escapeString(text)}"`,
    `  splitbill_id: "${record.id}"`,
  ];

  const showPrice = !!fx && fx.quote !== record.currency;
  const amountStrs = postings.map((p) => p.amount.toFixed(2));
  const accountWidth = Math.max(...postings.map((p) => p.account.length));
  const amountWidth = Math.max(...amountStrs.map((s) => s.length));
  postings.forEach((p, i) => {
    const price = showPrice ? ` @ ${formatRate(fx!.rate)} ${fx!.quote}` : "";
    lines.push(
      `  ${p.account.padEnd(accountWidth)}  ${amountStrs[i].padStart(amountWidth)} ${record.currency}${price}`,
    );
  });
  return lines.join("\n");
}

export type BeancountExportRange =
  | { kind: "new"; since: Date | null }
  | { kind: "all" }
  | { kind: "custom"; from: Date; to: Date };

export type BeancountExportInput = {
  groupTitle: string;
  defaultCurrency: string;
  userId: number;
  accounts: BeancountAccounts;
  range: BeancountExportRange;
  /** Oldest first. `rate` converts to the group default; `narration` as for {@link recordToBeancount}. */
  records: { record: BeancountRecord; rate: number; narration?: string }[];
  now: Date;
};

function rangeLabel(range: BeancountExportRange): string {
  if (range.kind === "all") return "全部";
  if (range.kind === "custom") {
    // The bounds are the viewer's local day boundaries as instants; their UTC date
    // would be a day off for anyone not on UTC, so print the instants themselves.
    return `消費日期 ${formatUtcMinute(range.from)} ~ ${formatUtcMinute(range.to)} UTC`;
  }
  return range.since ? `${formatUtcMinute(range.since)} UTC 之後新增的紀錄` : "全部（第一次匯出）";
}

/**
 * The whole export file: a comment header, the `open` directives, then one
 * transaction per record that touches U's ledger. Returns the counts too, so
 * the page's preview and the file can't disagree about what is in it.
 *
 * `open` is written live only for the event account and only when the file
 * starts the ledger (everything, or a first export), since a second `open` of the
 * same account is an error in beancount. Expenses and Cash are almost always
 * opened already in the user's own ledger, so they are commented out.
 */
export function groupToBeancount(input: BeancountExportInput): {
  text: string;
  included: number;
  skipped: number;
} {
  const entries: string[] = [];
  let firstDate: string | null = null;
  for (const { record, rate, narration } of input.records) {
    const fx =
      record.currency === input.defaultCurrency ? null : { quote: input.defaultCurrency, rate };
    const entry = recordToBeancount(record, input.userId, input.accounts, fx, narration);
    if (!entry) continue;
    entries.push(entry);
    firstDate ??= beancountDate(record.spentAt);
  }
  const included = entries.length;
  const skipped = input.records.length - included;

  const startsLedger =
    input.range.kind === "all" || (input.range.kind === "new" && input.range.since === null);
  const openDate = firstDate ?? beancountDate(input.now.toISOString());
  const lines = [
    `; 揪帳 · ${escapeString(input.groupTitle)}`,
    `; 匯出時間 ${formatUtcMinute(input.now)} UTC · 預設貨幣 ${input.defaultCurrency}`,
    `; 範圍：${rangeLabel(input.range)}`,
    `; ${included} 筆${skipped > 0 ? `，略過 ${skipped} 筆跟你無關的紀錄` : ""}`,
    "",
    `; ${openDate} open ${input.accounts.expenses}`,
    `; ${openDate} open ${input.accounts.cash}`,
    `${startsLedger ? "" : "; "}${openDate} open ${input.accounts.event}`,
  ];
  for (const entry of entries) lines.push("", entry);
  return { text: lines.join("\n") + "\n", included, skipped };
}
