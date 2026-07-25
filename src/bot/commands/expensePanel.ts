import { Composer } from "grammy";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { expenses } from "@/db/schema";

import {
  loadCard,
  loadGroupMembers,
  loadSplitEntries,
  renderCard,
  writeSplits,
  type CardMode,
} from "../expenseCard";
import { promptForExpenseField } from "./add";
import type { BotContext } from "../context";

/**
 * The inline "⚙️ 調整" panel on an expense card.
 *
 * Everything the old text grammar made you memorise — who splits, per-person
 * shares, the currency — is a button here instead. The panel has no state of
 * its own: it always reads the expense back from the DB and re-renders, so an
 * old card still works and two people tapping at once converge rather than
 * fight.
 */
export const expensePanel = new Composer<BotContext>();

/** Swap the card that the pressed button belongs to into another mode. */
async function show(ctx: BotContext, expenseId: number, mode: CardMode) {
  const card = await renderCard(ctx, expenseId, mode);
  if (!card) {
    await ctx.answerCallbackQuery({ text: "找不到這筆支出（可能已刪除）", show_alert: true });
    return;
  }
  // Re-selecting what's already selected renders byte-identical output, which
  // Telegram rejects with "message is not modified" — a no-op, not an error.
  await ctx
    .editMessageText(card.text, { parse_mode: "HTML", reply_markup: card.reply_markup })
    .catch(() => undefined);
  await ctx.answerCallbackQuery();
}

/**
 * Guard shared by every panel button: the expense must exist and the presser
 * must be the person who created it (same rule as 🗑 刪除).
 */
async function guard(ctx: BotContext, expenseId: number) {
  if (!ctx.dbUser) {
    await ctx.answerCallbackQuery({ text: "無法識別使用者", show_alert: true });
    return null;
  }
  const card = await loadCard(expenseId);
  if (!card) {
    await ctx.answerCallbackQuery({ text: "找不到這筆支出（可能已刪除）", show_alert: true });
    return null;
  }
  if (card.expense.createdBy !== ctx.dbUser.id) {
    await ctx.answerCallbackQuery({ text: "只有記帳的人可以調整這筆", show_alert: true });
    return null;
  }
  return card;
}

/* ── navigation ───────────────────────────────────────────────────────── */

expensePanel.callbackQuery(/^exp:(adj|who|shr|cur):(\d+)$/, async (ctx) => {
  const [, section, id] = ctx.match;
  const expenseId = Number(id);
  if (!(await guard(ctx, expenseId))) return;

  const mode = { adj: "adjust", who: "who", shr: "shares", cur: "currency" }[section] as CardMode;
  await show(ctx, expenseId, mode);
});

expensePanel.callbackQuery(/^exp:done:(\d+)$/, async (ctx) => {
  await show(ctx, Number(ctx.match[1]), "default");
});

/* ── 👥 誰分 ──────────────────────────────────────────────────────────── */

expensePanel.callbackQuery(/^exp:whot:(\d+):(\d+)$/, async (ctx) => {
  const expenseId = Number(ctx.match[1]);
  const userId = Number(ctx.match[2]);
  const card = await guard(ctx, expenseId);
  if (!card) return;

  const entries = await loadSplitEntries(expenseId);
  const next = entries.some((e) => e.userId === userId)
    ? entries.filter((e) => e.userId !== userId)
    : [...entries, { userId, weight: 1 }];

  if (next.length === 0) {
    await ctx.answerCallbackQuery({ text: "至少要留一個人分帳", show_alert: true });
    return;
  }

  await writeSplits(expenseId, card.expense.amount, next);
  await show(ctx, expenseId, "who");
});

expensePanel.callbackQuery(/^exp:whoall:(\d+)$/, async (ctx) => {
  const expenseId = Number(ctx.match[1]);
  const card = await guard(ctx, expenseId);
  if (!card) return;

  const members = await loadGroupMembers(card.expense.groupId);
  if (members.length === 0) {
    await ctx.answerCallbackQuery({ text: "這個群組沒有可分帳的人", show_alert: true });
    return;
  }
  // Keep existing weights so 全選 adds people without discarding a shares setup.
  const weights = new Map((await loadSplitEntries(expenseId)).map((e) => [e.userId, e.weight]));
  await writeSplits(
    expenseId,
    card.expense.amount,
    members.map((m) => ({ userId: m.id, weight: weights.get(m.id) ?? 1 })),
  );
  await show(ctx, expenseId, "who");
});

expensePanel.callbackQuery(/^exp:whome:(\d+)$/, async (ctx) => {
  const expenseId = Number(ctx.match[1]);
  const card = await guard(ctx, expenseId);
  if (!card) return;

  await writeSplits(expenseId, card.expense.amount, [{ userId: ctx.dbUser!.id, weight: 1 }]);
  await show(ctx, expenseId, "who");
});

/* ── ⚖️ 份數 ─────────────────────────────────────────────────────────── */

const MAX_WEIGHT = 4;

expensePanel.callbackQuery(/^exp:shrc:(\d+):(\d+)$/, async (ctx) => {
  const expenseId = Number(ctx.match[1]);
  const userId = Number(ctx.match[2]);
  const card = await guard(ctx, expenseId);
  if (!card) return;

  const entries = (await loadSplitEntries(expenseId)).map((e) =>
    e.userId === userId ? { ...e, weight: (Math.round(e.weight) % MAX_WEIGHT) + 1 } : e,
  );
  await writeSplits(expenseId, card.expense.amount, entries);
  await show(ctx, expenseId, "shares");
});

expensePanel.callbackQuery(/^exp:shrr:(\d+)$/, async (ctx) => {
  const expenseId = Number(ctx.match[1]);
  const card = await guard(ctx, expenseId);
  if (!card) return;

  const entries = (await loadSplitEntries(expenseId)).map((e) => ({ ...e, weight: 1 }));
  await writeSplits(expenseId, card.expense.amount, entries);
  await show(ctx, expenseId, "shares");
});

/* ── 💱 幣別 ─────────────────────────────────────────────────────────── */

expensePanel.callbackQuery(/^exp:curs:(\d+):([A-Z]{3})$/, async (ctx) => {
  const expenseId = Number(ctx.match[1]);
  const code = ctx.match[2];
  const card = await guard(ctx, expenseId);
  if (!card) return;

  if (card.expense.currency !== code) {
    // The pinned rate (if any) was quoted against the old currency.
    await db
      .update(expenses)
      .set({ currency: code, fxRate: null, fxQuote: null, updatedAt: new Date() })
      .where(eq(expenses.id, expenseId));
  }
  await show(ctx, expenseId, "currency");
});

/* ── ✏️ 金額 / 其他幣別 (ForceReply) ──────────────────────────────────── */

expensePanel.callbackQuery(/^exp:(amt|curo):(\d+)$/, async (ctx) => {
  const [, kind, id] = ctx.match;
  const expenseId = Number(id);
  if (!(await guard(ctx, expenseId))) return;

  const panelMessageId = ctx.callbackQuery.message?.message_id;
  if (!panelMessageId) {
    await ctx.answerCallbackQuery({ text: "無法取得訊息資訊", show_alert: true });
    return;
  }

  await promptForExpenseField(ctx, expenseId, kind === "amt" ? "amount" : "currency", panelMessageId);
  await ctx.answerCallbackQuery();
});
