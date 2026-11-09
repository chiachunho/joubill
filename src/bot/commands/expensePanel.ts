import { Composer } from "grammy";

import { TOAST } from "@/lib/buttons";

import {
  loadCard,
  loadGroupMembers,
  loadSplitState,
  originOf,
  pickerMembers,
  renderCard,
  type CardMode,
} from "../expenseCard";
import { setExpenseCurrency, setExpensePayer, writeSplits } from "../expenseEdits";
import { actorOf } from "../actor";
import { promptForExpenseField } from "./add";
import type { BotContext } from "../context";

/**
 * The inline "☰ 調整" panel on an expense card.
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
  const card = await renderCard(originOf(ctx), expenseId, mode);
  if (!card) {
    await ctx.answerCallbackQuery({ text: TOAST.recordGone, show_alert: true });
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
 * Guard shared by every panel button: we must know who's pressing, and the
 * expense must still exist.
 *
 * Deliberately *not* an ownership check. The ledger is shared, so anyone in the
 * group can fix a mistake without waiting for whoever typed it — and gating the
 * panel while the card's own App 編輯 button opens an unrestricted form would
 * be a guarantee in name only. Attribution replaces the lock: the card shows who
 * recorded the expense (see CLAUDE.md).
 *
 * It IS a group check. Callback data is attacker-controlled — it arrives as a
 * plain string and nothing ties it to the button we sent — so an id alone would
 * let a member of one group edit or delete another group's expense. This is the
 * bot-side equivalent of the REST layer's `assertGroupMember`.
 */
async function guard(ctx: BotContext, expenseId: number) {
  if (!ctx.dbUser || !ctx.dbGroup) {
    await ctx.answerCallbackQuery({ text: TOAST.unknownUser, show_alert: true });
    return null;
  }
  const card = await loadCard(expenseId);
  if (!card || card.expense.groupId !== ctx.dbGroup.id) {
    await ctx.answerCallbackQuery({ text: TOAST.recordGone, show_alert: true });
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
  const expenseId = Number(ctx.match[1]);
  if (!(await guard(ctx, expenseId))) return;
  await show(ctx, expenseId, "default");
});

/* ── 誰付 ──────────────────────────────────────────────────────────── */

const MULTI_PAYER_TOAST = "多位付款人請用 App 編輯";

expensePanel.callbackQuery(/^exp:pay:(\d+)$/, async (ctx) => {
  const expenseId = Number(ctx.match[1]);
  const card = await guard(ctx, expenseId);
  if (!card) return;
  if (!card.payerEditable) {
    await ctx.answerCallbackQuery({ text: MULTI_PAYER_TOAST, show_alert: true });
    return;
  }
  await show(ctx, expenseId, "payer");
});

expensePanel.callbackQuery(/^exp:payt:(\d+):(\d+)$/, async (ctx) => {
  const expenseId = Number(ctx.match[1]);
  const userId = Number(ctx.match[2]);
  const card = await guard(ctx, expenseId);
  if (!card) return;
  if (!card.payerEditable) {
    await ctx.answerCallbackQuery({ text: MULTI_PAYER_TOAST, show_alert: true });
    return;
  }

  // Callback data is attacker-controlled, so the new payer must belong to this
  // group. The current payer is always allowed: they may have left since, and
  // the panel keeps listing them (see cardKeyboard, mode "payer").
  const members = await loadGroupMembers(card.expense.groupId);
  if (!pickerMembers(members, card.payers).some((m) => m.id === userId)) {
    await ctx.answerCallbackQuery({ text: "對方不在這個群組", show_alert: true });
    return;
  }

  // The payer count is checked again under the record lock; a second payer added
  // since the guard above makes this a no-op rather than a silent overwrite.
  if (!(await setExpensePayer(expenseId, userId, actorOf(ctx)))) {
    await ctx.answerCallbackQuery({ text: MULTI_PAYER_TOAST, show_alert: true });
    return;
  }
  await show(ctx, expenseId, "payer");
});

/* ── 誰分 ──────────────────────────────────────────────────────────── */

expensePanel.callbackQuery(/^exp:whot:(\d+):(\d+)$/, async (ctx) => {
  const expenseId = Number(ctx.match[1]);
  const userId = Number(ctx.match[2]);
  const card = await guard(ctx, expenseId);
  if (!card) return;

  const { entries } = await loadSplitState(expenseId);
  const next = entries.some((e) => e.userId === userId)
    ? entries.filter((e) => e.userId !== userId)
    : [...entries, { userId, weight: 1 }];

  if (next.length === 0) {
    await ctx.answerCallbackQuery({ text: "至少要留一個人", show_alert: true });
    return;
  }

  await writeSplits(expenseId, card.expense.amount, next, actorOf(ctx));
  await show(ctx, expenseId, "who");
});

expensePanel.callbackQuery(/^exp:whoall:(\d+)$/, async (ctx) => {
  const expenseId = Number(ctx.match[1]);
  const card = await guard(ctx, expenseId);
  if (!card) return;

  const members = await loadGroupMembers(card.expense.groupId);
  const { entries } = await loadSplitState(expenseId);

  // Union, not replacement: loadGroupMembers filters out inactive members, so
  // rebuilding from it alone would drop someone who already has a share and
  // silently redistribute their debt. Existing weights are kept too, so 全選
  // adds people without discarding a 份數 setup — same set the 誰分 keyboard lists.
  const next = [...entries];
  const seated = new Set(entries.map((e) => e.userId));
  for (const m of members) {
    if (!seated.has(m.id)) next.push({ userId: m.id, weight: 1 });
  }
  if (next.length === 0) {
    await ctx.answerCallbackQuery({ text: "還沒有人可以分帳", show_alert: true });
    return;
  }
  await writeSplits(expenseId, card.expense.amount, next, actorOf(ctx));
  await show(ctx, expenseId, "who");
});

expensePanel.callbackQuery(/^exp:whome:(\d+)$/, async (ctx) => {
  const expenseId = Number(ctx.match[1]);
  const card = await guard(ctx, expenseId);
  if (!card) return;

  await writeSplits(
    expenseId,
    card.expense.amount,
    [{ userId: ctx.dbUser!.id, weight: 1 }],
    actorOf(ctx),
  );
  await show(ctx, expenseId, "who");
});

/* ── 份數 ───────────────────────────────────────────────────────────── */

/** No real split needs more; it only stops a runaway tap from making a silly number. */
const MAX_WEIGHT = 99;

/** Change one person's weight by `delta`, or say why it can't move. */
async function stepWeight(ctx: BotContext, expenseId: number, userId: number, delta: number) {
  const card = await guard(ctx, expenseId);
  if (!card) return;

  const { entries } = await loadSplitState(expenseId);
  const target = entries.find((e) => e.userId === userId);
  if (!target) {
    await ctx.answerCallbackQuery({ text: TOAST.staleButton, show_alert: true });
    return;
  }
  const next = Math.round(target.weight) + delta;
  if (next < 1) {
    await ctx.answerCallbackQuery({ text: "最少 1 份" });
    return;
  }
  if (next > MAX_WEIGHT) {
    await ctx.answerCallbackQuery({ text: `最多 ${MAX_WEIGHT} 份` });
    return;
  }
  await writeSplits(
    expenseId,
    card.expense.amount,
    entries.map((e) => (e.userId === userId ? { ...e, weight: next } : e)),
    actorOf(ctx),
  );
  await show(ctx, expenseId, "shares");
}

expensePanel.callbackQuery(/^exp:shr([di]):(\d+):(\d+)$/, async (ctx) => {
  const [, dir, id, user] = ctx.match;
  await stepWeight(ctx, Number(id), Number(user), dir === "i" ? 1 : -1);
});

/** Cards posted before ⊖ / ⊕ still carry the old cycling button (×1 → ×4 → ×1). */
expensePanel.callbackQuery(/^exp:shrc:(\d+):(\d+)$/, async (ctx) => {
  const expenseId = Number(ctx.match[1]);
  const userId = Number(ctx.match[2]);
  const card = await guard(ctx, expenseId);
  if (!card) return;

  const entries = (await loadSplitState(expenseId)).entries.map((e) =>
    e.userId === userId ? { ...e, weight: (Math.round(e.weight) % 4) + 1 } : e,
  );
  await writeSplits(expenseId, card.expense.amount, entries, actorOf(ctx));
  await show(ctx, expenseId, "shares");
});

expensePanel.callbackQuery(/^exp:shrr:(\d+)$/, async (ctx) => {
  const expenseId = Number(ctx.match[1]);
  const card = await guard(ctx, expenseId);
  if (!card) return;

  const entries = (await loadSplitState(expenseId)).entries.map((e) => ({ ...e, weight: 1 }));
  await writeSplits(expenseId, card.expense.amount, entries, actorOf(ctx));
  await show(ctx, expenseId, "shares");
});

/* ── 幣別 ─────────────────────────────────────────────────────────── */

expensePanel.callbackQuery(/^exp:curs:(\d+):([A-Z]{3})$/, async (ctx) => {
  const expenseId = Number(ctx.match[1]);
  const code = ctx.match[2];
  const card = await guard(ctx, expenseId);
  if (!card) return;

  await setExpenseCurrency(expenseId, code, actorOf(ctx));
  await show(ctx, expenseId, "currency");
});

/* ── 金額 / 其他幣別 (ForceReply) ──────────────────────────────────── */

expensePanel.callbackQuery(/^exp:(amt|curo):(\d+)$/, async (ctx) => {
  const [, kind, id] = ctx.match;
  const expenseId = Number(id);
  if (!(await guard(ctx, expenseId))) return;

  const panelMessageId = ctx.callbackQuery.message?.message_id;
  if (!panelMessageId) {
    await ctx.answerCallbackQuery({ text: TOAST.actionFailed, show_alert: true });
    return;
  }

  await promptForExpenseField(
    ctx,
    expenseId,
    kind === "amt" ? "amount" : "currency",
    panelMessageId,
  );
  await ctx.answerCallbackQuery();
});
