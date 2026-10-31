import { labelUser, type Profile } from "@/lib/label";
import { fmtGrouped } from "@/lib/money";
import { escapeHtml, mention } from "@/lib/telegram-html";

/**
 * Group-chat message text for records, for the cases the expense card doesn't
 * cover. Pure — no DB, no network — so it is unit-tested directly and can be
 * called from both the bot and the API route handlers.
 *
 * Expenses render through `renderCard` (`src/bot/expenseCard.ts`) instead: it is
 * the richer, interactive version and there must be exactly one renderer for a
 * given message, or an edit would rewrite a card into something else. What lives
 * here is the settlement notice (no card exists for settlements) and the
 * deleted-record line, which is shared by both kinds.
 */

export type NoticePerson = {
  /** Required so a snapshot stored in the audit log can still key an avatar or
   *  a mention later, when the name captured alongside it has gone stale. */
  userId: number;
  /** The person's chosen name as it was then. Absent from snapshots written before
   *  issue #101; `displayName()` reads a missing key as unset. */
  displayName: string | null;
  firstName: string;
  lastName?: string | null;
  username: string | null;
  telegramId: number | null;
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
  return mention(labelUser(u), u.telegramId);
}

function money(record: NoticeRecord): string {
  return `${fmtGrouped(record.amount)} ${record.currency}`;
}

/** The group notice for a settlement: "💸 A → B　1,200 TWD". */
export function formatSettlementNotice(record: NoticeRecord): string {
  const from = record.payers[0]?.user;
  const to = record.splits[0]?.user;
  const amount = `<b>${money(record)}</b>`;
  if (!from || !to) return `💸 轉帳　${amount}`;
  return `💸 ${nameOf(from)} → ${nameOf(to)}　${amount}`;
}

/** Short description of what was deleted, for the tombstone line. */
function whatWasDeleted(record: NoticeRecord): string {
  if (record.type === "settlement") {
    const from = record.payers[0]?.user;
    const to = record.splits[0]?.user;
    return from && to
      ? `轉帳 ${nameOf(from)} → ${nameOf(to)} ${money(record)}`
      : `轉帳 ${money(record)}`;
  }
  const desc = record.description ? `（${escapeHtml(record.description)}）` : "";
  return `${money(record)}${desc}`;
}

/**
 * Replaces a deleted record's message. The message itself is kept, so the chat
 * stays a readable history: it says what went, who had recorded it, and who
 * removed it. That attribution is what stands in for a per-record owner lock
 * (see CLAUDE.md), so don't quietly drop the names.
 */
export function formatDeletedNotice(params: {
  record: NoticeRecord;
  /** Who recorded it. Left out of the text when they are also the deleter. */
  creator: (Profile & { userId: number }) | null;
  deleter: NoticePerson & { userId: number };
}): string {
  const { record, creator, deleter } = params;

  const origin =
    creator && creator.userId !== deleter.userId
      ? `，原本由 ${escapeHtml(labelUser(creator))} 記錄`
      : "";

  return `🗑 已刪除 ${whatWasDeleted(record)}${origin}\n— ${nameOf(deleter)}`;
}
