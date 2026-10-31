/**
 * Render a single splitbill record (expense or settlement) as a beancount
 * transaction, from the **personal-ledger perspective** of the current user (U).
 *
 * Accounts default to {@link DEFAULT_BEANCOUNT_ACCOUNTS} but are configurable
 * per (user, group) via the `accounts` argument (see CLAUDE.md):
 * - expenses (`Expenses:Uncategorized`)  — U's own share of consumption.
 * - cash (`Assets:Cash`)                 — cash U actually fronted (negative).
 * - receivablePrefix (`Assets:Receivable`) + person leaf — net position between
 *   U and each other person X (positive = X owes U, negative = U owes X).
 *
 * The transaction always balances in the record's own currency. When `fx` is
 * supplied, every posting also carries an `@ <rate> <quote>` price so it
 * balances in the group's default currency too.
 *
 * This module is pure (no DB, no fetch) so it can be unit-tested directly; the
 * caller resolves the FX rate and the people lookup before calling in.
 */

import type { Profile } from "@/lib/label";
import { displayName } from "@/lib/profile";

export type BeancountParty = { userId: number; amount: number };

export type BeancountRecord = {
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
 * - `{ quote, rate: number }` — annotate every posting with `@ rate quote`.
 * - `{ quote, rate: null }` — conversion was wanted but the rate is unavailable;
 *   emit a comment instead of a price.
 */
export type BeancountFx = { quote: string; rate: number | null } | null | undefined;

/**
 * Per-(user, group) account customisation. `personAccounts` maps a member's
 * user id to the account leaf to use under `receivablePrefix`; members absent
 * from the map fall back to {@link beancountAccountName}.
 */
export type BeancountAccounts = {
  expenses: string;
  cash: string;
  receivablePrefix: string;
  /** member user id (as string key) → account leaf under `receivablePrefix`. */
  personAccounts?: Record<string, string>;
};

/** Built-in defaults, also used as the settings-form placeholders. */
export const DEFAULT_BEANCOUNT_ACCOUNTS: BeancountAccounts = {
  expenses: "Expenses:Uncategorized",
  cash: "Assets:Cash",
  receivablePrefix: "Assets:Receivable",
};

/** `kind` lets balance() find the receivable legs without matching on the (now configurable) account string. */
type Posting = { account: string; amount: number; kind: "expenses" | "cash" | "receivable" };

/** A beancount account leaf must start with an uppercase letter or a digit. */
function sanitizeComponent(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9]/g, "");
  if (!cleaned) return "";
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/**
 * Turn a person into a valid beancount account leaf. Prefers the (ASCII-safe)
 * username, falls back to the sanitized name, and finally to `User<id>` so a
 * non-ASCII-only name (e.g. pure Chinese) still produces a legal account.
 */
export function beancountAccountName(person: Profile): string {
  const fromUsername = person.username ? sanitizeComponent(person.username) : "";
  if (fromUsername) return fromUsername;
  const fromName = sanitizeComponent(displayName(person).replace(/ /g, ""));
  if (fromName) return fromName;
  return `User${person.userId ?? 0}`;
}

function receivableAccount(person: Profile, accounts: BeancountAccounts): string {
  // `||` (not `??`) so a blank configured leaf falls back to the auto name
  // instead of producing an invalid `<prefix>:` with a trailing colon.
  const leaf =
    accounts.personAccounts?.[String(person.userId ?? -1)] || beancountAccountName(person);
  return `${accounts.receivablePrefix}:${leaf}`;
}

/** Build a receivable posting for a person. */
function receivablePosting(person: Profile, amount: number, accounts: BeancountAccounts): Posting {
  return { account: receivableAccount(person, accounts), amount, kind: "receivable" };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function personFor(peopleById: Map<number, Profile>, userId: number): Profile {
  return (
    peopleById.get(userId) ?? {
      userId,
      displayName: null,
      firstName: null,
      lastName: null,
      username: null,
    }
  );
}

/** Sum per-user contributions into a Map. */
function sumByUser(parties: BeancountParty[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const p of parties) m.set(p.userId, (m.get(p.userId) ?? 0) + p.amount);
  return m;
}

/** Build the personal-ledger postings for a normal expense. */
function expensePostings(
  record: BeancountRecord,
  currentUserId: number,
  peopleById: Map<number, Profile>,
  accounts: BeancountAccounts,
): Posting[] {
  const paid = sumByUser(record.payers);
  const owed = sumByUser(record.splits);
  const everyone = new Set<number>([...paid.keys(), ...owed.keys()]);

  const paidU = paid.get(currentUserId) ?? 0;
  const owedU = owed.get(currentUserId) ?? 0;
  const netU = round2(paidU - owedU);

  const owedR = round2(owedU);
  const paidR = round2(paidU);
  const postings: Posting[] = [];
  if (owedR !== 0) postings.push({ account: accounts.expenses, amount: owedR, kind: "expenses" });
  if (paidR !== 0) postings.push({ account: accounts.cash, amount: -paidR, kind: "cash" });

  // Allocate U's net across the opposite-sign counterparties, proportional to
  // their own net. In the common single-payer case this reduces to "each
  // debtor's share"; in multi-payer cases it keeps U's ledger self-consistent.
  if (netU !== 0) {
    const sign = netU > 0 ? 1 : -1; // U is a net creditor (+1) or net debtor (-1)
    const counterparties: { person: Profile; weight: number }[] = [];
    let totalWeight = 0;
    for (const uid of everyone) {
      if (uid === currentUserId) continue;
      const net = (paid.get(uid) ?? 0) - (owed.get(uid) ?? 0);
      const weight = -sign * net; // pick the opposite-sign counterparties
      if (weight > 0) {
        counterparties.push({ person: personFor(peopleById, uid), weight });
        totalWeight += weight;
      }
    }
    if (totalWeight > 0) {
      // netU > 0 → receivables positive; netU < 0 → payables negative.
      for (const c of counterparties) {
        const share = round2((c.weight / totalWeight) * Math.abs(netU)) * sign;
        if (share !== 0) postings.push(receivablePosting(c.person, share, accounts));
      }
    }
  }

  return balance(postings);
}

/** Build postings for a settlement (from → to, single amount). */
function settlementPostings(
  record: BeancountRecord,
  currentUserId: number,
  peopleById: Map<number, Profile>,
  accounts: BeancountAccounts,
): { postings: Posting[]; uninvolved: boolean } {
  const fromId = record.payers[0]?.userId;
  const toId = record.splits[0]?.userId;
  const amount = round2(record.amount);
  const cash = (n: number): Posting => ({ account: accounts.cash, amount: n, kind: "cash" });

  if (currentUserId === fromId) {
    // U repays someone: settle what U owed them, paying cash.
    return {
      postings: [receivablePosting(personFor(peopleById, toId), amount, accounts), cash(-amount)],
      uninvolved: false,
    };
  }
  if (currentUserId === toId) {
    // U receives a repayment: cash in, the payer's debt to U is reduced.
    return {
      postings: [cash(amount), receivablePosting(personFor(peopleById, fromId), -amount, accounts)],
      uninvolved: false,
    };
  }
  // U not involved — neutral two-party representation.
  return {
    postings: [
      receivablePosting(personFor(peopleById, fromId), amount, accounts),
      receivablePosting(personFor(peopleById, toId), -amount, accounts),
    ],
    uninvolved: true,
  };
}

/** Index of the largest-magnitude posting matching `pick`, or -1 if none match. */
function largestBy(postings: Posting[], pick: (p: Posting) => boolean): number {
  let idx = -1;
  for (let i = 0; i < postings.length; i++) {
    if (!pick(postings[i])) continue;
    if (idx === -1 || Math.abs(postings[i].amount) > Math.abs(postings[idx].amount)) idx = i;
  }
  return idx;
}

/**
 * Fold any rounding residual back so the legs sum to 0. The residual only comes
 * from the proportional receivable allocation, so absorb it into the largest
 * receivable leg — keeping the exact Cash/Expenses figures faithful — and fall
 * back to the largest leg overall if there is no receivable.
 */
function balance(postings: Posting[]): Posting[] {
  if (postings.length === 0) return postings;
  const total = round2(postings.reduce((s, p) => s + p.amount, 0));
  if (total === 0) return postings;
  let idx = largestBy(postings, (p) => p.kind === "receivable");
  if (idx === -1) idx = largestBy(postings, () => true);
  postings[idx] = { ...postings[idx], amount: round2(postings[idx].amount - total) };
  return postings;
}

function escapeNarration(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/[\r\n]+/g, " ")
    .trim();
}

function dateOf(iso: string): string {
  // Use the UTC calendar date of the timestamp.
  return new Date(iso).toISOString().slice(0, 10);
}

/** Format an FX rate compactly (trim trailing zeros, no scientific notation). */
function formatRate(rate: number): string {
  let s = rate.toFixed(10);
  if (s.includes(".")) s = s.replace(/0+$/, "").replace(/\.$/, "");
  return s;
}

function render(
  record: BeancountRecord,
  postings: Posting[],
  fx: BeancountFx,
  comments: string[],
): string {
  const lines: string[] = [];
  for (const c of comments) lines.push(`; ${c}`);

  const narration = record.description ? escapeNarration(record.description) : "";
  lines.push(`${dateOf(record.spentAt)} * "${narration}"`);

  const showPrice = !!fx && fx.rate != null && fx.quote !== record.currency;
  const amountStrs = postings.map((p) => p.amount.toFixed(2));
  const accountWidth = Math.max(0, ...postings.map((p) => p.account.length));
  const amountWidth = Math.max(0, ...amountStrs.map((s) => s.length));

  postings.forEach((p, i) => {
    const price = showPrice ? ` @ ${formatRate(fx!.rate!)} ${fx!.quote}` : "";
    lines.push(
      `  ${p.account.padEnd(accountWidth)}  ${amountStrs[i].padStart(amountWidth)} ${record.currency}${price}`,
    );
  });

  return lines.join("\n");
}

/**
 * Render `record` as a beancount transaction from `currentUserId`'s perspective.
 * `peopleById` maps user ids to display profiles (for account names). `fx` is
 * resolved by the caller (see {@link BeancountFx}). `accounts` is the user's
 * per-group account customisation (see {@link BeancountAccounts}); it defaults
 * to {@link DEFAULT_BEANCOUNT_ACCOUNTS}.
 */
export function recordToBeancount(
  record: BeancountRecord,
  currentUserId: number,
  peopleById: Map<number, Profile>,
  fx?: BeancountFx,
  accounts: BeancountAccounts = DEFAULT_BEANCOUNT_ACCOUNTS,
): string {
  const comments: string[] = [];
  if (fx && fx.rate == null && fx.quote !== record.currency) {
    comments.push(`匯率不可得（${record.currency}→${fx.quote}）`);
  }

  if (record.type === "settlement") {
    const { postings, uninvolved } = settlementPostings(
      record,
      currentUserId,
      peopleById,
      accounts,
    );
    if (uninvolved) comments.push("你未參與這筆還款");
    return render(record, postings, fx, comments);
  }

  const postings = expensePostings(record, currentUserId, peopleById, accounts);
  // No legs means U neither paid for nor shares this expense; without a note the
  // pasted transaction would be an empty (invalid) beancount entry.
  if (postings.length === 0) comments.push("你與這筆支出無關");
  return render(record, postings, fx, comments);
}
