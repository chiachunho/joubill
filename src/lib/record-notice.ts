import { labelUser } from "@/lib/label";
import { fmtGrouped } from "@/lib/money";
import { escapeHtml, mention } from "@/lib/telegram-html";

/**
 * Renders the group-chat notification message for one record (expense or
 * settlement). Pure — no DB, no network — so it is unit-tested directly and can
 * be called from both the bot (`/add`) and the API route handlers, guaranteeing
 * the text a record gets on creation is identical to the text it gets after an
 * edit from the Mini App. See `src/lib/notify.ts` for the delivery side.
 */

export type NoticePerson = {
  firstName: string;
  lastName?: string | null;
  username: string | null;
  telegramId: number | null;
  /**
   * Set by the bot when the user literally typed "@username" for this person in
   * `/add`: we echo it back so Telegram auto-links it, matching what the sender
   * wrote. Everywhere else (and on any later edit, where the original wording is
   * long gone) names render as tappable tg:// inline mentions.
   */
  typedAt?: boolean;
};

export type NoticeLeg = { user: NoticePerson; amount: number };

export type NoticeRecord = {
  type: "expense" | "settlement";
  amount: number;
  currency: string;
  description?: string | null;
  /** Who paid. A settlement has exactly one: the sender. */
  payers: NoticeLeg[];
  /** Who owes. A settlement has exactly one: the receiver. */
  splits: NoticeLeg[];
};

function nameOf(u: NoticePerson): string {
  return u.typedAt && u.username ? "@" + u.username : mention(labelUser(u), u.telegramId);
}

const cents = (n: number) => Math.round(n * 100);

/** "A、B 各 250" when every share matches, otherwise "A 300、B 200". */
function splitLine(splits: NoticeLeg[]): string {
  if (splits.length === 0) return "";
  if (splits.length === 1) return `${nameOf(splits[0].user)} ${fmtGrouped(splits[0].amount)}`;

  const allSame = splits.every((s) => cents(s.amount) === cents(splits[0].amount));
  return allSame
    ? `${splits.map((s) => nameOf(s.user)).join("、")} 各 ${fmtGrouped(splits[0].amount)}`
    : splits.map((s) => `${nameOf(s.user)} ${fmtGrouped(s.amount)}`).join("、");
}

function expenseBody(record: NoticeRecord): string {
  const { payers, splits, amount, currency } = record;
  const descPart = record.description ? `（${escapeHtml(record.description)}）` : "";

  // Single payer reads as a sentence; multiple payers need their own amounts.
  const payerPart =
    payers.length === 1
      ? nameOf(payers[0].user)
      : payers.map((p) => `${nameOf(p.user)} ${fmtGrouped(p.amount)}`).join("、");

  const head = payers.length === 0 ? "" : `${payerPart} 付了 `;
  const line1 = `${head}<b>${fmtGrouped(amount)} ${currency}</b>${descPart}`;
  const line2 = splitLine(splits);

  return line2 ? `${line1}\n${line2}` : line1;
}

function settlementBody(record: NoticeRecord): string {
  const from = record.payers[0]?.user;
  const to = record.splits[0]?.user;
  const money = `<b>${fmtGrouped(record.amount)} ${record.currency}</b>`;
  if (!from || !to) return `💸 轉帳　${money}`;
  return `💸 ${nameOf(from)} → ${nameOf(to)}　${money}`;
}

/**
 * Telegram HTML for a record's group message. `deleted` keeps the original text
 * but strikes it through and appends a marker — the message itself is never
 * removed, so the chat history stays intact.
 */
export function formatRecordNotice(record: NoticeRecord, opts: { deleted?: boolean } = {}): string {
  const body = record.type === "settlement" ? settlementBody(record) : expenseBody(record);
  return opts.deleted ? `<s>${body}</s>\n\n🗑️ 已刪除` : body;
}
