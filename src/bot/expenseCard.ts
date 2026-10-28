import { InlineKeyboard } from "grammy";
import { and, desc, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { expensePayers, expenseSplits, expenses, groupMembers, groups, users } from "@/db/schema";
import { getRate, loadGroupRateOverrides } from "@/lib/fx";
import { BTN } from "@/lib/buttons";
import { expenseLink } from "@/lib/deep-link";
import { labelUser } from "@/lib/label";
import { fmtGrouped, n, splitEqual } from "@/lib/money";
import { computeSplits } from "@/lib/splits";

import { escapeHtml, mention } from "./format";
import { USER_COLUMNS } from "./profiles";
import type { BotContext } from "./context";

export type DbUser = {
  id: number;
  username: string | null;
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

/** Current split entries (debtor + share weight) for an expense, in display order. */
export async function loadSplitState(expenseId: number): Promise<SplitState> {
  const rows = await db
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
    spentAt: Date;
  };
  defaultCurrency: string;
  payers: DbUser[];
  splits: Array<{ user: DbUser; amount: number; weight: number }>;
  /** False for Mini-App-entered exact/percent/adjustment splits — see PANEL_SHARE_TYPES. */
  panelEditable: boolean;
  /**
   * False when the expense has several payers. 💳 誰付 picks one person, so it
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

  const [payerRows, splitRows] = await Promise.all([
    db
      .select(USER_COLUMNS)
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
  ]);

  return {
    expense: {
      ...expense,
      amount: n(expense.amount),
    },
    defaultCurrency: expense.defaultCurrency,
    payers: payerRows,
    splits: splitRows.map((r) => ({
      user: {
        id: r.id,
        username: r.username,
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
 * Currency shortcuts in the 💱 picker: what this expense is set to, the group
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

function splitLine(card: CardData): string {
  const { splits } = card;
  if (splits.length === 0) return "（沒有人分帳）";

  const name = (u: DbUser) => mention(labelUser(u), u.telegramId);
  const allSame = splits.every(
    (s) => s.amount === splits[0].amount && s.weight === splits[0].weight,
  );
  if (allSame)
    return `${splits.map((s) => name(s.user)).join("、")} 各 ${fmtGrouped(splits[0].amount)}`;

  return splits
    .map((s) => {
      const w = s.weight !== 1 ? ` ×${fmtGrouped(s.weight)}` : "";
      return `${name(s.user)}${w} ${fmtGrouped(s.amount)}`;
    })
    .join("、");
}

const MODE_HINT: Partial<Record<CardMode, string>> = {
  who: "👥 點名字切換誰要分帳",
  shares: "⚖️ 點名字調整份數（×1 → ×2 → ×3 → ×4）",
  currency: "💱 選擇這筆的幣別",
  payer: "💳 點名字選誰付了這筆",
};

async function cardText(card: CardData, mode: CardMode): Promise<string> {
  const { expense, defaultCurrency, payers } = card;
  const who =
    payers.length > 0 ? payers.map((p) => mention(labelUser(p), p.telegramId)).join("、") : "?";
  const descPart = expense.description ? `（${escapeHtml(expense.description)}）` : "";

  const lines = [`${who} 付了 <b>${fmtGrouped(expense.amount)} ${expense.currency}</b>${descPart}`];

  if (expense.currency !== defaultCurrency) {
    // Best-effort only: a failed FX lookup must never block showing the expense.
    try {
      const overrides = await loadGroupRateOverrides(expense.groupId);
      const rate = await getRate(expense.currency, defaultCurrency, expense.spentAt, overrides);
      lines.push(
        `≈ ${fmtGrouped(Math.round(expense.amount * rate * 100) / 100)} ${defaultCurrency}`,
      );
    } catch {
      /* no conversion line */
    }
  }

  lines.push(splitLine(card));

  const hint =
    mode === "adjust" && !card.panelEditable
      ? `這筆的分帳是在 App 裡自訂的，要改分帳請用 ${BTN.appEdit}`
      : MODE_HINT[mode];
  if (hint) lines.push("", hint);
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
 * The people a 👥 / 💳 picker offers: the group's members, plus anyone already on
 * the expense. Someone who has since left must stay pickable, or the picker could
 * not show who is currently on the expense.
 */
function pickerMembers(members: DbUser[], onExpense: DbUser[]): DbUser[] {
  return [...members, ...onExpense.filter((u) => !members.some((m) => m.id === u.id))];
}

async function cardKeyboard(
  origin: CardOrigin,
  card: CardData,
  mode: CardMode,
): Promise<InlineKeyboard> {
  const id = card.expense.id;
  const kb = new InlineKeyboard();

  if (mode === "default") {
    kb.text(BTN.adjust, `exp:adj:${id}`);
    if (!card.expense.receiptFileId) kb.text(BTN.receipt, `upload_receipt:${id}`);
    return kb.text(BTN.delete, `del_exp:${id}`);
  }

  if (mode === "adjust") {
    if (card.payerEditable) kb.text(BTN.payer, `exp:pay:${id}`).row();
    // 誰分 / 份數 recompute every share from weights, so they're only offered
    // when the panel owns the split — otherwise they'd flatten a custom one.
    if (card.panelEditable) {
      kb.text(BTN.who, `exp:who:${id}`).text(BTN.shares, `exp:shr:${id}`);
    }
    return kb
      .text(BTN.currency, `exp:cur:${id}`)
      .row()
      .text(BTN.amount, `exp:amt:${id}`)
      .url(BTN.appEdit, expenseLink(origin.botUsername, origin.chatId, id))
      .row()
      .text(BTN.done, `exp:done:${id}`);
  }

  if (mode === "who") {
    const members = await loadGroupMembers(card.expense.groupId);
    const included = new Set(card.splits.map((s) => s.user.id));
    const listed = pickerMembers(
      members,
      card.splits.map((s) => s.user),
    );
    listed.forEach((m, i) => {
      kb.text(`${included.has(m.id) ? "✅" : "⬜"} ${labelUser(m)}`, `exp:whot:${id}:${m.id}`);
      if (i % 2 === 1) kb.row();
    });
    if (listed.length % 2 === 1) kb.row();
    return kb
      .text(BTN.selectAll, `exp:whoall:${id}`)
      .text(BTN.onlyMe, `exp:whome:${id}`)
      .row()
      .text(BTN.back, `exp:adj:${id}`);
  }

  if (mode === "payer") {
    const members = await loadGroupMembers(card.expense.groupId);
    const current = new Set(card.payers.map((p) => p.id));
    const listed = pickerMembers(members, card.payers);
    listed.forEach((m, i) => {
      kb.text(`${current.has(m.id) ? "✅" : "⬜"} ${labelUser(m)}`, `exp:payt:${id}:${m.id}`);
      if (i % 2 === 1) kb.row();
    });
    if (listed.length % 2 === 1) kb.row();
    return kb.text(BTN.back, `exp:adj:${id}`);
  }

  if (mode === "shares") {
    card.splits.forEach((s, i) => {
      kb.text(`${labelUser(s.user)} ×${fmtGrouped(s.weight)}`, `exp:shrc:${id}:${s.user.id}`);
      if (i % 2 === 1) kb.row();
    });
    if (card.splits.length % 2 === 1) kb.row();
    return kb.text(BTN.resetShares, `exp:shrr:${id}`).row().text(BTN.back, `exp:adj:${id}`);
  }

  // currency
  const codes = await currencyChoices(
    card.expense.groupId,
    card.expense.currency,
    card.defaultCurrency,
  );
  for (const code of codes) {
    kb.text(code === card.expense.currency ? `✅ ${code}` : code, `exp:curs:${id}:${code}`);
  }
  return kb.row().text(BTN.otherCurrency, `exp:curo:${id}`).text(BTN.back, `exp:adj:${id}`);
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
