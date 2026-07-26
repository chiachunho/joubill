import { InlineKeyboard, type Api } from "grammy";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { expensePayers, expenseSplits, expenses, groups, users } from "@/db/schema";
import { serverEnv } from "@/lib/env";
import { n } from "@/lib/money";
import { formatRecordNotice, type NoticeLeg, type NoticeRecord } from "@/lib/record-notice";

/**
 * Group-chat notifications for records (expenses and settlements).
 *
 * Every record owns exactly one message in the group chat, tracked by
 * `expenses.notice_message_id`:
 *   created → send it and remember the message_id
 *   edited  → edit that same message in place
 *   deleted → edit it into a struck-through "已刪除" version, never remove it
 *
 * A record created by the bot's `/add` reuses the reply `/add` already posts as
 * its notice message, so there is never a duplicate.
 *
 * Notifications are silent: the bot's api middleware (src/bot/index.ts) stamps
 * `disable_notification: true` on every `send*` call, and nothing here overrides
 * it. `editMessageText` never pings by design.
 *
 * Every entry point swallows its errors — a chat the bot was kicked from, or a
 * message someone deleted, must never fail the API request that triggered it.
 */

export type LoadedNotice = {
  recordId: number;
  groupId: number;
  chatId: number;
  noticeMessageId: number | null;
  record: NoticeRecord;
};

/** Cached across invocations in the same lambda — the username never changes. */
let cachedBotUsername: string | undefined;

async function botUsername(api: Api): Promise<string | null> {
  if (cachedBotUsername) return cachedBotUsername;
  try {
    const me = await api.getMe();
    cachedBotUsername = me.username;
    return cachedBotUsername;
  } catch {
    return null;
  }
}

/**
 * Loads everything `formatRecordNotice` needs for one record.
 *
 * Callers handling a deletion must call this *before* deleting the row — the
 * record (and its message id) are gone afterwards.
 */
export async function loadNoticeRecord(recordId: number): Promise<LoadedNotice | null> {
  const [row] = await db
    .select({
      id: expenses.id,
      groupId: expenses.groupId,
      type: expenses.type,
      amount: expenses.amount,
      currency: expenses.currency,
      description: expenses.description,
      noticeMessageId: expenses.noticeMessageId,
      chatId: groups.telegramChatId,
    })
    .from(expenses)
    .innerJoin(groups, eq(groups.id, expenses.groupId))
    .where(eq(expenses.id, recordId));

  if (!row) return null;

  const [payerRows, splitRows] = await Promise.all([
    db
      .select({
        amount: expensePayers.amount,
        firstName: users.firstName,
        lastName: users.lastName,
        username: users.username,
        telegramId: users.telegramId,
      })
      .from(expensePayers)
      .innerJoin(users, eq(users.id, expensePayers.payerId))
      .where(eq(expensePayers.expenseId, recordId))
      .orderBy(expensePayers.id),
    db
      .select({
        amount: expenseSplits.amount,
        firstName: users.firstName,
        lastName: users.lastName,
        username: users.username,
        telegramId: users.telegramId,
      })
      .from(expenseSplits)
      .innerJoin(users, eq(users.id, expenseSplits.debtorId))
      .where(eq(expenseSplits.expenseId, recordId))
      .orderBy(expenseSplits.id),
  ]);

  const toLeg = (r: (typeof payerRows)[number]): NoticeLeg => ({
    amount: n(r.amount),
    user: {
      firstName: r.firstName,
      lastName: r.lastName,
      username: r.username,
      telegramId: r.telegramId,
    },
  });

  return {
    recordId: row.id,
    groupId: row.groupId,
    chatId: row.chatId,
    noticeMessageId: row.noticeMessageId,
    record: {
      type: row.type === "settlement" ? "settlement" : "expense",
      amount: n(row.amount),
      currency: row.currency,
      description: row.description,
      payers: payerRows.map(toLeg),
      splits: splitRows.map(toLeg),
    },
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

/**
 * "編輯" deep-links into the Mini App record form; "刪除" reuses the bot's
 * existing `del_exp` callback (which enforces creator-only deletion).
 */
export async function buildNoticeKeyboard(
  api: Api,
  loaded: LoadedNotice,
): Promise<InlineKeyboard | undefined> {
  const username = await botUsername(api);
  if (!username) return undefined;

  const appName = serverEnv().TELEGRAM_MINI_APP_NAME;
  const slug = loaded.record.type === "settlement" ? "stl" : "exp";
  const url = `https://t.me/${username}/${appName}?startapp=group_${loaded.chatId}_${slug}_${loaded.recordId}`;

  return new InlineKeyboard().url("編輯", url).text("刪除", `del_exp:${loaded.recordId}`);
}

/** Telegram's "nothing changed" rejection — an edit no-op, not a failure. */
function isNotModified(err: unknown): boolean {
  return err instanceof Error && err.message.includes("message is not modified");
}

/** Posts the notice for a freshly created record and remembers its message id. */
export async function sendRecordNotice(api: Api, recordId: number): Promise<void> {
  try {
    const loaded = await loadNoticeRecord(recordId);
    if (!loaded) return;

    const sent = await api.sendMessage(loaded.chatId, formatRecordNotice(loaded.record), {
      parse_mode: "HTML",
      reply_markup: await buildNoticeKeyboard(api, loaded),
    });
    await rememberNoticeMessage(recordId, sent.message_id);
  } catch (err) {
    console.error("[notify] sendRecordNotice failed:", err);
  }
}

/**
 * Rewrites the record's existing notice in place. Falls back to posting a fresh
 * one when there is nothing to edit — records predating this feature, a message
 * someone deleted, or one Telegram refuses to edit.
 */
export async function updateRecordNotice(api: Api, recordId: number): Promise<void> {
  try {
    const loaded = await loadNoticeRecord(recordId);
    if (!loaded) return;

    const text = formatRecordNotice(loaded.record);
    // editMessageText drops the keyboard unless it is passed again.
    const reply_markup = await buildNoticeKeyboard(api, loaded);

    if (loaded.noticeMessageId != null) {
      try {
        await api.editMessageText(loaded.chatId, loaded.noticeMessageId, text, {
          parse_mode: "HTML",
          reply_markup,
        });
        return;
      } catch (err) {
        // An edit that changes nothing is a success, not a reason to re-post.
        if (isNotModified(err)) return;
      }
    }

    const sent = await api.sendMessage(loaded.chatId, text, {
      parse_mode: "HTML",
      reply_markup,
    });
    await rememberNoticeMessage(recordId, sent.message_id);
  } catch (err) {
    console.error("[notify] updateRecordNotice failed:", err);
  }
}

/**
 * Marks a deleted record's notice as deleted, keeping the message in the chat.
 * Takes a snapshot loaded *before* the row was removed.
 */
export async function markNoticeDeleted(api: Api, snapshot: LoadedNotice | null): Promise<void> {
  if (!snapshot?.noticeMessageId) return;
  try {
    // No reply_markup: the buttons point at a record that no longer exists.
    await api.editMessageText(
      snapshot.chatId,
      snapshot.noticeMessageId,
      formatRecordNotice(snapshot.record, { deleted: true }),
      { parse_mode: "HTML" },
    );
  } catch (err) {
    if (!isNotModified(err)) console.error("[notify] markNoticeDeleted failed:", err);
  }
}
