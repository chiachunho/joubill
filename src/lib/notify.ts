import { InlineKeyboard, type Api } from "grammy";
import { eq } from "drizzle-orm";

import { renderCard } from "@/bot/expenseCard";
import { db } from "@/db";
import {
  expensePayers,
  expenseReceipts,
  expenseSplits,
  expenses,
  groups,
  users,
} from "@/db/schema";
import { BTN } from "@/lib/buttons";
import { telegramChatId } from "@/lib/chat";
import { botUsername } from "@/lib/bot-username";
import { settlementLink } from "@/lib/deep-link";
import { n } from "@/lib/money";
import { type RecordSnapshot } from "@/lib/record-audit";
import {
  formatDeletedNotice,
  formatSettlementNotice,
  type NoticeLeg,
  type NoticePerson,
} from "@/lib/record-notice";
import { resolveReceiptFileIds } from "@/lib/receipts";

/**
 * Group-chat messages for records (expenses and settlements).
 *
 * Every record owns exactly one message in the group chat, tracked by
 * `expenses.notice_message_id`:
 *   created → send it and remember the message_id
 *   edited  → edit that same message in place
 *   deleted → edit it into a "🗑 已刪除 …" line, never remove it
 *
 * An expense renders as the **expense card** (`src/bot/expenseCard.ts`) — the
 * same text and buttons `/add` posts, so an edit made in the Mini App refreshes
 * the card rather than replacing it with something poorer. `/add` binds its own
 * card via `rememberNoticeMessage`, so a bot-created expense never gets a
 * duplicate. Settlements have no card and render through
 * `formatSettlementNotice`.
 *
 * Notifications are silent: the bot's api middleware (src/bot/index.ts) stamps
 * `disable_notification: true` on every `send*` call, and nothing here overrides
 * it. `editMessageText` never pings by design.
 *
 * Every entry point swallows its errors — a chat the bot was kicked from, or a
 * message someone deleted, must never fail the API request that triggered it.
 */

/**
 * Anything that can run a select: the pooled `db`, or an open transaction.
 * Callers that need a snapshot to line up exactly with a write pass their
 * transaction, so a concurrent edit can't slip in between the two.
 */
export type Executor = Pick<typeof db, "select">;

export type LoadedNotice = {
  recordId: number;
  groupId: number;
  /** NULL for a group made on the web: the record is still loaded (the audit log needs it), but there is no chat to write into. */
  chatId: number | null;
  noticeMessageId: number | null;
  /** Who recorded it, for the deleted-record line. */
  creator: NoticePerson | null;
  /**
   * Full snapshot rather than just what the message renders. The audit log
   * (`src/lib/record-mutation.ts`) stores this same object as its before/after,
   * so there is exactly one loader and one shape — a change can't be described
   * one way in the chat and another way in the log.
   */
  record: RecordSnapshot;
};

/**
 * Loads everything needed to render one record's message.
 *
 * Callers handling a deletion must call this *before* deleting the row — the
 * record (and its message id) are gone afterwards.
 */
export async function loadNoticeRecord(
  recordId: number,
  exec: Executor = db,
): Promise<LoadedNotice | null> {
  const creatorUser = users;

  const [row] = await exec
    .select({
      id: expenses.id,
      groupId: expenses.groupId,
      type: expenses.type,
      amount: expenses.amount,
      currency: expenses.currency,
      description: expenses.description,
      spentAt: expenses.spentAt,
      fxRate: expenses.fxRate,
      fxQuote: expenses.fxQuote,
      receiptFileId: expenses.receiptFileId,
      noticeMessageId: expenses.noticeMessageId,
      chatType: groups.chatType,
      chatId: groups.chatId,
      creatorId: creatorUser.id,
      creatorFirstName: creatorUser.firstName,
      creatorLastName: creatorUser.lastName,
      creatorUsername: creatorUser.username,
      creatorTelegramId: creatorUser.telegramId,
    })
    .from(expenses)
    .innerJoin(groups, eq(groups.id, expenses.groupId))
    .leftJoin(creatorUser, eq(creatorUser.id, expenses.createdBy))
    .where(eq(expenses.id, recordId));

  if (!row) return null;
  // A group outside Telegram has no chat: callers that write messages skip on a null `chatId`,
  // but the snapshot itself must still load or the audit row for the record is never written.
  const chatId = telegramChatId(row);

  const [payerRows, splitRows, receiptRows] = await Promise.all([
    exec
      .select({
        amount: expensePayers.amount,
        userId: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        username: users.username,
        telegramId: users.telegramId,
      })
      .from(expensePayers)
      .innerJoin(users, eq(users.id, expensePayers.payerId))
      .where(eq(expensePayers.expenseId, recordId))
      .orderBy(expensePayers.id),
    exec
      .select({
        amount: expenseSplits.amount,
        userId: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        username: users.username,
        telegramId: users.telegramId,
      })
      .from(expenseSplits)
      .innerJoin(users, eq(users.id, expenseSplits.debtorId))
      .where(eq(expenseSplits.expenseId, recordId))
      .orderBy(expenseSplits.id),
    exec
      .select({ fileId: expenseReceipts.fileId })
      .from(expenseReceipts)
      .where(eq(expenseReceipts.expenseId, recordId)),
  ]);

  const toLeg = (r: (typeof payerRows)[number]): NoticeLeg => ({
    amount: n(r.amount),
    user: {
      userId: r.userId,
      firstName: r.firstName,
      lastName: r.lastName,
      username: r.username,
      telegramId: r.telegramId,
    },
  });

  return {
    recordId: row.id,
    groupId: row.groupId,
    chatId,
    noticeMessageId: row.noticeMessageId,
    creator:
      row.creatorId != null
        ? {
            userId: row.creatorId,
            firstName: row.creatorFirstName!,
            lastName: row.creatorLastName,
            username: row.creatorUsername,
            telegramId: row.creatorTelegramId,
          }
        : null,
    record: {
      type: row.type === "settlement" ? "settlement" : "expense",
      amount: n(row.amount),
      currency: row.currency,
      description: row.description,
      spentAt: row.spentAt.toISOString(),
      fxRate: row.fxRate != null ? n(row.fxRate) : null,
      fxQuote: row.fxQuote,
      receipts: resolveReceiptFileIds(
        receiptRows.map((r) => r.fileId),
        row.receiptFileId,
      ).length,
      payers: payerRows.map(toLeg),
      splits: splitRows.map(toLeg),
    },
  };
}

/** Shapes a `users` row as the person performing a deletion. */
export function deleterOf(u: {
  id: number;
  firstName: string;
  lastName: string | null;
  username: string | null;
  telegramId: number | null;
}): NoticePerson {
  return {
    userId: u.id,
    firstName: u.firstName,
    lastName: u.lastName,
    username: u.username,
    telegramId: u.telegramId,
  };
}

/** Binds a group message to a record so later edits update that same message. */
export async function rememberNoticeMessage(recordId: number, messageId: number): Promise<void> {
  await db
    .update(expenses)
    .set({ noticeMessageId: messageId })
    .where(eq(expenses.id, recordId))
    .catch(() => undefined);
}

/** The 編輯 / 刪除 buttons on a settlement notice (expenses get the card's own). */
function settlementKeyboard(
  username: string,
  loaded: LoadedNotice & { chatId: number },
): InlineKeyboard {
  const url = settlementLink(username, loaded.chatId, loaded.recordId);
  return new InlineKeyboard().url(BTN.appEdit, url).text(BTN.delete, `del_exp:${loaded.recordId}`);
}

type Rendered = { text: string; reply_markup: InlineKeyboard | undefined };

/**
 * Expenses render as the card `/add` posts, settlements as their own notice.
 * Returns null when the bot's username can't be resolved (both kinds need it
 * for the Mini App deep link).
 */
async function render(
  api: Api,
  loaded: LoadedNotice & { chatId: number },
): Promise<Rendered | null> {
  const username = await botUsername(api);
  if (!username) return null;

  if (loaded.record.type === "settlement") {
    return {
      text: formatSettlementNotice(loaded.record),
      reply_markup: settlementKeyboard(username, loaded),
    };
  }

  const card = await renderCard(
    { botUsername: username, chatId: loaded.chatId },
    loaded.recordId,
    "default",
  );
  return card ? { text: card.text, reply_markup: card.reply_markup } : null;
}

/** Telegram's "nothing changed" rejection — an edit no-op, not a failure. */
function isNotModified(err: unknown): boolean {
  return err instanceof Error && err.message.includes("message is not modified");
}

/** Posts the message for a freshly created record and remembers its message id. */
export async function sendRecordNotice(api: Api, recordId: number): Promise<void> {
  try {
    const loaded = await loadNoticeRecord(recordId);
    if (!loaded || loaded.chatId === null) return;
    const rendered = await render(api, { ...loaded, chatId: loaded.chatId });
    if (!rendered) return;

    const sent = await api.sendMessage(loaded.chatId, rendered.text, {
      parse_mode: "HTML",
      reply_markup: rendered.reply_markup,
    });
    await rememberNoticeMessage(recordId, sent.message_id);
  } catch (err) {
    console.error("[notify] sendRecordNotice failed:", err);
  }
}

/**
 * Rewrites the record's existing message in place. Falls back to posting a
 * fresh one when there is nothing to edit — records predating this feature, a
 * message someone deleted, or one Telegram refuses to edit.
 *
 * An expense card is re-rendered in `default` mode, so a card someone had left
 * open on the ⚙️ panel collapses back to the summary view. That is intended:
 * the panel's state is a UI mode, not part of the record.
 *
 * `repost: false` only ever edits: with no message, or one Telegram won't edit, it does
 * nothing. A bulk refresh (a member merge) must not post a first message for every old
 * record it happens to touch.
 */
export async function updateRecordNotice(
  api: Api,
  recordId: number,
  { repost = true }: { repost?: boolean } = {},
): Promise<void> {
  try {
    const loaded = await loadNoticeRecord(recordId);
    if (!loaded || loaded.chatId === null) return;
    const chatId = loaded.chatId;
    const rendered = await render(api, { ...loaded, chatId });
    if (!rendered) return;

    if (loaded.noticeMessageId != null) {
      try {
        // editMessageText drops the keyboard unless it is passed again.
        await api.editMessageText(chatId, loaded.noticeMessageId, rendered.text, {
          parse_mode: "HTML",
          reply_markup: rendered.reply_markup,
        });
        return;
      } catch (err) {
        // An edit that changes nothing is a success, not a reason to re-post.
        if (isNotModified(err)) return;
      }
    }
    if (!repost) return;

    const sent = await api.sendMessage(chatId, rendered.text, {
      parse_mode: "HTML",
      reply_markup: rendered.reply_markup,
    });
    await rememberNoticeMessage(recordId, sent.message_id);
  } catch (err) {
    console.error("[notify] updateRecordNotice failed:", err);
  }
}

/**
 * Replaces a deleted record's message with the tombstone line, keeping the
 * message itself. Takes a snapshot loaded *before* the row was removed.
 */
export async function markNoticeDeleted(
  api: Api,
  snapshot: LoadedNotice | null,
  deleter: NoticePerson,
): Promise<void> {
  if (!snapshot?.noticeMessageId || snapshot.chatId === null) return;
  try {
    // No reply_markup: the buttons point at a record that no longer exists.
    await api.editMessageText(
      snapshot.chatId,
      snapshot.noticeMessageId,
      formatDeletedNotice({ record: snapshot.record, creator: snapshot.creator, deleter }),
      { parse_mode: "HTML" },
    );
  } catch (err) {
    if (!isNotModified(err)) console.error("[notify] markNoticeDeleted failed:", err);
  }
}
