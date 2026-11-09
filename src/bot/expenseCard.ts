import { InlineKeyboard } from "grammy";
import { and, desc, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { expensePayers, expenseSplits, expenses, groupMembers, groups, users } from "@/db/schema";
import { getRate, loadGroupRateContext } from "@/lib/fx";
import { BTN, button, choice, sharesLessLabel, sharesMoreLabel } from "@/lib/buttons";
import { cardBody } from "@/lib/expense-card-text";
import { expenseLink } from "@/lib/deep-link";
import { labelUser } from "@/lib/label";
import { loadCreatedVia } from "@/lib/record-via";
import { formatMcpLine } from "@/lib/record-notice";
import { n, splitEqual } from "@/lib/money";
import { computeSplits } from "@/lib/splits";

import { escapeHtml } from "./format";
import { USER_COLUMNS } from "./profiles";
import type { BotContext } from "./context";

export type DbUser = {
  id: number;
  username: string | null;
  displayName: string | null;
  firstName: string;
  lastName: string | null;
  telegramId: number | null;
};

/** Active members of a group, in a stable order. */
export async function loadGroupMembers(groupId: number): Promise<DbUser[]> {
  return db
    .select(USER_COLUMNS)
    .from(users)
    .innerJoin(groupMembers, eq(groupMembers.userId, users.id))
    .where(and(eq(groupMembers.groupId, groupId), sql`${groupMembers.status} <> 'inactive'`))
    .orderBy(users.id);
}

/* ── split writing ────────────────────────────────────────────────────── */

export type SplitEntry = { userId: number; weight: number };

/**
 * Build the `expense_splits` rows for a set of share weights. When every weight
 * is 1 the split is stored as a plain `equal` split (so the Mini App form opens
 * in 均分 mode), otherwise as `shares` with the weight kept in `split_value` so
 * the original input round-trips.
 */
export function splitRowsFor(expenseId: number, total: number, entries: SplitEntry[]) {
  const asShares = entries.some((e) => e.weight !== 1);
  if (!asShares) {
    return splitEqual(total, entries.length).map((amount, i) => ({
      expenseId,
      debtorId: entries[i].userId,
      amount: amount.toFixed(2),
      shareType: "equal",
      splitValue: null as string | null,
    }));
  }
  return computeSplits(
    total,
    "shares",
    entries.map((e) => ({ userId: e.userId, value: String(e.weight) })),
  ).map((s, i) => ({
    expenseId,
    debtorId: s.debtorId,
    amount: s.amount.toFixed(2),
    shareType: "shares",
    splitValue: String(entries[i].weight) as string | null,
  }));
}

/**
 * Share types the button panel can express. Anything else — `exact`, `percent`,
 * `adjustment`, all of which only the Mini App form can produce — carries
 * per-person intent that recomputing from weights would silently destroy, so
 * the panel hides its split controls instead of flattening them.
 */
const PANEL_SHARE_TYPES = new Set(["equal", "shares"]);

export type SplitState = {
  entries: SplitEntry[];
  /** False when the split came from the Mini App and only it should edit it. */
  panelEditable: boolean;
};

/**
 * Current split entries (debtor + share weight) for an expense, in display order.
 * Pass a transaction as `exec` when the result feeds a write, so it is read under
 * that write's lock.
 */
export async function loadSplitState(
  expenseId: number,
  exec: Pick<typeof db, "select"> = db,
): Promise<SplitState> {
  const rows = await exec
    .select({
      debtorId: expenseSplits.debtorId,
      amount: expenseSplits.amount,
      shareType: expenseSplits.shareType,
      splitValue: expenseSplits.splitValue,
    })
    .from(expenseSplits)
    .where(eq(expenseSplits.expenseId, expenseId))
    .orderBy(expenseSplits.id);

  return {
    entries: rows.map((r) => ({
      userId: r.debtorId,
      weight: r.shareType === "shares" && r.splitValue != null ? n(r.splitValue) : 1,
    })),
    panelEditable: rows.length > 0 && rows.every((r) => PANEL_SHARE_TYPES.has(r.shareType)),
  };
}

/* ── card rendering ───────────────────────────────────────────────────── */

export type CardMode = "default" | "adjust" | "who" | "shares" | "currency" | "payer";

type CardData = {
  expense: {
    id: number;
    groupId: number;
    amount: number;
    currency: string;
    description: string | null;
    createdBy: number;
    receiptFileId: string | null;
    /** `YYYY-MM-DD`. */
    spentAt: string;
  };
  defaultCurrency: string;
  /**
   * The AI assistant that entered it and the person whose connection it was (issue #150),
   * for the "✦ 小明 透過 Claude 記錄" line. Null for anything a person entered.
   */
  mcp: { via: string; creator: DbUser | null } | null;
  payers: DbUser[];
  /** What each payer put in, in the same order as `payers`. */
  payerAmounts: number[];
  splits: Array<{ user: DbUser; amount: number; weight: number }>;
  /** False for Mini-App-entered exact/percent/adjustment splits — see PANEL_SHARE_TYPES. */
  panelEditable: boolean;
  /**
   * False when the expense has several payers. 誰付 picks one person, so it
   * would collapse per-payer contributions the same way the split controls would.
   */
  payerEditable: boolean;
};

export async function loadCard(expenseId: number): Promise<CardData | null> {
  const [expense] = await db
    .select({
      id: expenses.id,
      groupId: expenses.groupId,
      amount: expenses.amount,
      currency: expenses.currency,
      description: expenses.description,
      createdBy: expenses.createdBy,
      receiptFileId: expenses.receiptFileId,
      spentAt: expenses.spentAt,
      defaultCurrency: groups.defaultCurrency,
    })
    .from(expenses)
    .innerJoin(groups, eq(groups.id, expenses.groupId))
    .where(eq(expenses.id, expenseId));
  if (!expense) return null;

  const [payerRows, splitRows, viaByRecord] = await Promise.all([
    db
      .select({ ...USER_COLUMNS, paid: expensePayers.amount })
      .from(expensePayers)
      .innerJoin(users, eq(users.id, expensePayers.payerId))
      .where(eq(expensePayers.expenseId, expenseId))
      .orderBy(expensePayers.id),
    db
      .select({
        ...USER_COLUMNS,
        splitAmount: expenseSplits.amount,
        shareType: expenseSplits.shareType,
        splitValue: expenseSplits.splitValue,
      })
      .from(expenseSplits)
      .innerJoin(users, eq(users.id, expenseSplits.debtorId))
      .where(eq(expenseSplits.expenseId, expenseId))
      .orderBy(expenseSplits.id),
    loadCreatedVia([expenseId]),
  ]);

  const via = viaByRecord.get(expenseId) ?? null;
  const [creator] = via
    ? await db.select(USER_COLUMNS).from(users).where(eq(users.id, expense.createdBy))
    : [];

  return {
    expense: {
      ...expense,
      amount: n(expense.amount),
    },
    defaultCurrency: expense.defaultCurrency,
    mcp: via ? { via, creator: creator ?? null } : null,
    payers: payerRows.map(({ paid: _paid, ...user }) => user),
    payerAmounts: payerRows.map((r) => n(r.paid)),
    splits: splitRows.map((r) => ({
      user: {
        id: r.id,
        username: r.username,
        displayName: r.displayName,
        firstName: r.firstName,
        lastName: r.lastName,
        telegramId: r.telegramId,
      },
      amount: n(r.splitAmount),
      weight: r.shareType === "shares" && r.splitValue != null ? n(r.splitValue) : 1,
    })),
    panelEditable:
      splitRows.length > 0 && splitRows.every((r) => PANEL_SHARE_TYPES.has(r.shareType)),
    payerEditable: payerRows.length === 1,
  };
}

/**
 * Currency shortcuts in the 幣別 picker: what this expense is set to, the group
 * default, then whatever the group actually uses most. Only three — a wall of
 * codes is slower to read than the 「其他…」 prompt is to type, and a group's
 * real vocabulary is one or two currencies plus the trip they're on.
 */
const CURRENCY_CHOICES = 3;

async function currencyChoices(
  groupId: number,
  current: string,
  fallback: string,
): Promise<string[]> {
  const used = await db
    .select({ currency: expenses.currency, uses: sql<number>`count(*)::int` })
    .from(expenses)
    .where(eq(expenses.groupId, groupId))
    .groupBy(expenses.currency)
    .orderBy(desc(sql`count(*)`))
    .limit(CURRENCY_CHOICES);

  const out: string[] = [];
  for (const code of [current, fallback, ...used.map((u) => u.currency), "TWD", "JPY", "USD"]) {
    if (code && !out.includes(code)) out.push(code);
  }
  return out.slice(0, CURRENCY_CHOICES);
}

const MODE_HINT: Partial<Record<CardMode, string>> = {
  who: "點名字加入或移出",
  shares: "按 ⊕ ⊖ 調整每人份數",
  currency: "這筆的幣別",
  payer: "誰付的？",
};

async function cardText(card: CardData, mode: CardMode): Promise<string> {
  const { expense, defaultCurrency } = card;

  let converted: { amount: number; currency: string } | null = null;
  if (expense.currency !== defaultCurrency) {
    // Best-effort only: a failed FX lookup must never block showing the expense.
    try {
      const rateCtx = await loadGroupRateContext(expense.groupId);
      const rate = await getRate(expense.currency, defaultCurrency, expense.spentAt, rateCtx);
      converted = {
        amount: Math.round(expense.amount * rate * 100) / 100,
        currency: defaultCurrency,
      };
    } catch {
      /* no conversion */
    }
  }

  const lines = cardBody({
    description: expense.description,
    amount: expense.amount,
    currency: expense.currency,
    converted,
    payers: card.payers.map((user, i) => ({ user, amount: card.payerAmounts[i] })),
    splits: card.splits,
  });

  // Kept in every mode, so the ☰ panel doesn't hide where the record came from. The
  // person is left out when they are the sole payer: the headline already names them.
  if (card.mcp) {
    const { creator, via } = card.mcp;
    const named = creator && !(card.payers.length === 1 && card.payers[0].id === creator.id);
    lines.push(formatMcpLine(named ? creator : null, via));
  }

  const hint =
    mode === "adjust" && !card.panelEditable
      ? `分帳在 App 自訂過，要改請按 ${BTN.appEdit}`
      : MODE_HINT[mode];
  if (hint) lines.push("", `<i>${escapeHtml(hint)}</i>`);
  return lines.join("\n");
}

/**
 * What rendering a card needs from its surroundings, so the card is not tied to
 * a bot update. The API route handlers re-render the same card when a record is
 * edited in the Mini App (see src/lib/notify.ts), and they have no `ctx`.
 */
export type CardOrigin = { botUsername: string; chatId: number };

/** The origin of a card being rendered in response to a group message/callback. */
export function originOf(ctx: BotContext): CardOrigin {
  return { botUsername: ctx.me.username, chatId: ctx.chat?.id ?? 0 };
}

/**
 * The people a 誰分 / 誰付 picker offers: the group's members, plus anyone already on
 * the expense. Someone who has since left must stay pickable, or the picker could
 * not show who is currently on the expense.
 */
export function pickerMembers(members: DbUser[], onExpense: DbUser[]): DbUser[] {
  return [...members, ...onExpense.filter((u) => !members.some((m) => m.id === u.id))];
}

/** Lay buttons out in rows of `perRow`. */
function grid(kb: InlineKeyboard, buttons: Array<() => void>, perRow: number) {
  buttons.forEach((add, i) => {
    add();
    if (i % perRow === perRow - 1) kb.row();
  });
  if (buttons.length % perRow !== 0) kb.row();
}

async function cardKeyboard(
  origin: CardOrigin,
  card: CardData,
  mode: CardMode,
): Promise<InlineKeyboard> {
  const id = card.expense.id;
  const kb = new InlineKeyboard();

  if (mode === "default") {
    kb.text(button("adjust"), `exp:adj:${id}`);
    if (!card.expense.receiptFileId) kb.text(button("receipt"), `upload_receipt:${id}`);
    return kb.text(button("delete"), `del_exp:${id}`);
  }

  if (mode === "adjust") {
    const items: Array<() => void> = [];
    if (card.payerEditable) items.push(() => kb.text(button("payer"), `exp:pay:${id}`));
    // 誰分 / 份數 recompute every share from weights, so they're only offered
    // when the panel owns the split — otherwise they'd flatten a custom one.
    if (card.panelEditable) {
      items.push(() => kb.text(button("who"), `exp:who:${id}`));
      items.push(() => kb.text(button("shares"), `exp:shr:${id}`));
    }
    items.push(() => kb.text(button("currency"), `exp:cur:${id}`));
    items.push(() => kb.text(button("amount"), `exp:amt:${id}`));
    items.push(() => kb.url(button("appEdit"), expenseLink(origin.botUsername, origin.chatId, id)));
    // Three to a row; ← 收起 joins the last row when there is room, else gets its own.
    if (items.length % 3 !== 0) {
      items.push(() => kb.text(button("collapse"), `exp:done:${id}`));
      grid(kb, items, 3);
    } else {
      grid(kb, items, 3);
      kb.text(button("collapse"), `exp:done:${id}`);
    }
    return kb;
  }

  if (mode === "who") {
    const members = await loadGroupMembers(card.expense.groupId);
    const included = new Set(card.splits.map((s) => s.user.id));
    const listed = pickerMembers(
      members,
      card.splits.map((s) => s.user),
    );
    grid(
      kb,
      listed.map(
        (m) => () =>
          kb.text(choice(labelUser(m), included.has(m.id), "multi"), `exp:whot:${id}:${m.id}`),
      ),
      2,
    );
    return kb
      .text(button("selectAll"), `exp:whoall:${id}`)
      .text(button("onlyMe"), `exp:whome:${id}`)
      .text(button("back"), `exp:adj:${id}`);
  }

  if (mode === "payer") {
    const members = await loadGroupMembers(card.expense.groupId);
    const current = new Set(card.payers.map((p) => p.id));
    const listed = pickerMembers(members, card.payers);
    grid(
      kb,
      listed.map(
        (m) => () =>
          kb.text(choice(labelUser(m), current.has(m.id), "multi"), `exp:payt:${id}:${m.id}`),
      ),
      2,
    );
    return kb.text(button("back"), `exp:adj:${id}`);
  }

  if (mode === "shares") {
    // One row per person, ⊖ and ⊕ only: Telegram splits a row evenly, so a bare ⊖ / ⊕
    // beside a name would be as wide as the name. The current weight shows on the card.
    for (const s of card.splits) {
      const label = labelUser(s.user);
      kb.text(sharesLessLabel(label), `exp:shrd:${id}:${s.user.id}`)
        .text(sharesMoreLabel(label), `exp:shri:${id}:${s.user.id}`)
        .row();
    }
    return kb.text(button("resetShares"), `exp:shrr:${id}`).text(button("back"), `exp:adj:${id}`);
  }

  // currency
  const codes = await currencyChoices(
    card.expense.groupId,
    card.expense.currency,
    card.defaultCurrency,
  );
  for (const code of codes) {
    kb.text(choice(code, code === card.expense.currency, "single"), `exp:curs:${id}:${code}`);
  }
  return kb
    .row()
    .text(button("otherCurrency"), `exp:curo:${id}`)
    .text(button("back"), `exp:adj:${id}`);
}

/** Build the full card (text + keyboard) for an expense, or null if it's gone. */
export async function renderCard(origin: CardOrigin, expenseId: number, mode: CardMode) {
  const card = await loadCard(expenseId);
  if (!card) return null;
  return {
    text: await cardText(card, mode),
    reply_markup: await cardKeyboard(origin, card, mode),
    card,
  };
}
