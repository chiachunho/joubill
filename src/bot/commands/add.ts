import { Composer, InlineKeyboard } from "grammy";
import { and, eq, inArray, lt, or } from "drizzle-orm";

import { db } from "@/db";
import {
  addAwaiting,
  expensePayers,
  expenseSplits,
  expenses,
  groupMembers,
  receiptAwaiting,
  users,
} from "@/db/schema";
import { upsertTelegramUser } from "@/lib/auth/upsertTelegramUser";
import { clientEnv } from "@/lib/env";
import { BTN } from "@/lib/buttons";
import { labelUser } from "@/lib/label";
import { rememberNoticeMessage } from "@/lib/notify";
import {
  ADD_USAGE,
  evalAmountExpr,
  isSupportedCurrency,
  parseAddMessage,
  type ParsedAdd,
} from "@/lib/parseAdd";
import { SUPPORTED_CURRENCIES } from "@/lib/zod";

import {
  loadGroupMembers,
  originOf,
  renderCard,
  setExpenseAmount,
  splitRowsFor,
  type DbUser,
} from "../expenseCard";
import { escapeHtml, mention } from "../format";
import { canVerifyMembership, verifyInChat } from "../membership";
import type { BotContext } from "../context";

export const addCommand = new Composer<BotContext>();

const PROMPT_NEW = `${ADD_USAGE}\n\n👇 直接回覆這則訊息`;

/** Rows older than 24 h are no longer actionable — cleaned up opportunistically. */
const STALE_MS = 24 * 60 * 60 * 1000;

/**
 * Send a ForceReply prompt and remember it, so the user's reply lands back in
 * the right place. `expenseId`/`field` are set when the reply edits an existing
 * expense instead of creating a new one.
 *
 * `selective` only opens the reply box for people Telegram considers targeted:
 * users @mentioned in the text, or the sender of the message being replied to.
 * A prompt hanging off the bot's own card targets *nobody*, so when there's no
 * user message to reply to we address the requester in the text instead.
 */
async function prompt(
  ctx: BotContext,
  text: string,
  extra: { expenseId?: number; field?: string; panelMessageId?: number } = {},
) {
  const replyTo = ctx.message?.message_id;
  const body = replyTo ? text : `${mentionRequester(ctx)} ${escapeHtml(text)}`;

  const sent = await ctx.reply(body, {
    parse_mode: replyTo ? undefined : "HTML",
    reply_to_message_id: replyTo,
    reply_markup: { force_reply: true, selective: true },
  });
  await db.insert(addAwaiting).values({
    chatId: ctx.chat!.id,
    messageId: sent.message_id,
    expenseId: extra.expenseId ?? null,
    field: extra.field ?? null,
    panelMessageId: extra.panelMessageId ?? null,
  });
}

/** A mention entity for the person who pressed the button, so `selective` targets them. */
function mentionRequester(ctx: BotContext): string {
  const from = ctx.from;
  if (!from) return "";
  return from.username
    ? "@" + from.username
    : mention(
        labelUser({ firstName: from.first_name, lastName: from.last_name ?? null, username: null }),
        from.id,
      );
}

/** Report a parse failure and immediately offer a one-tap retry. */
async function replyAddError(ctx: BotContext, message: string) {
  await prompt(ctx, `${message}\n\n👇 直接回覆這則訊息重試`);
}

export async function promptForExpenseField(
  ctx: BotContext,
  expenseId: number,
  field: "amount" | "currency",
  panelMessageId: number,
) {
  const text =
    field === "amount"
      ? "輸入新的金額（例如 500、1,200、3k、150+200）"
      : `輸入幣別代碼：${SUPPORTED_CURRENCIES.join(" / ")}`;
  await prompt(ctx, text, { expenseId, field, panelMessageId });
}

/* ── creating an expense ──────────────────────────────────────────────── */

/**
 * Resolve who splits the expense. With no mentions that's everyone in the
 * group; with mentions it's exactly the people named (the payer is only
 * included if they named themselves — "我請客" is a real case).
 */
async function resolveParticipants(
  groupId: number,
  parsed: ParsedAdd,
  /** Display names for text_mention targets, so a miss can name who it missed. */
  namesByTelegramId: Map<number, string> = new Map(),
): Promise<{ participants: DbUser[] } | { error: string }> {
  if (parsed.mentionUsernames.length === 0 && parsed.mentionTelegramIds.length === 0) {
    return { participants: await loadGroupMembers(groupId) };
  }

  const conditions = [];
  if (parsed.mentionUsernames.length > 0)
    conditions.push(inArray(users.username, parsed.mentionUsernames));
  if (parsed.mentionTelegramIds.length > 0)
    conditions.push(inArray(users.telegramId, parsed.mentionTelegramIds));

  const found = await db
    .select({
      id: users.id,
      username: users.username,
      firstName: users.firstName,
      lastName: users.lastName,
      telegramId: users.telegramId,
    })
    .from(users)
    .innerJoin(groupMembers, eq(groupMembers.userId, users.id))
    .where(and(eq(groupMembers.groupId, groupId), or(...conditions)));

  const foundUsernames = new Set(found.map((u) => u.username));
  const foundTelegramIds = new Set(found.map((u) => u.telegramId));
  const missing = [
    ...parsed.mentionUsernames.filter((u) => !foundUsernames.has(u)).map((u) => "@" + u),
    ...parsed.mentionTelegramIds
      .filter((id) => !foundTelegramIds.has(id))
      .map((id) => namesByTelegramId.get(id) ?? "（某位成員）"),
  ];

  if (missing.length > 0) {
    return {
      // Under privacy mode "just talk in the group" does NOT reach the bot, so
      // point at the paths that actually seat someone (see /join's docs).
      error:
        `找不到揪帳裡的 ${missing.join("、")}。\n` +
        `要先把人加進來：回覆對方的訊息再打 /join，或請他點群組裡「${BTN.openApp}」的按鈕。\n` +
        `或者先「/add 500 晚餐」記起來，再用「${BTN.adjust} → ${BTN.who}」挑人。`,
    };
  }
  return { participants: found };
}

/**
 * Create the expense and post its card. Shared by the text command, the
 * ForceReply path and the photo-caption path in receiptUpload.ts.
 */
export async function handleAddParsed(
  ctx: BotContext & {
    dbGroup: NonNullable<BotContext["dbGroup"]>;
    dbUser: NonNullable<BotContext["dbUser"]>;
  },
  parsed: ParsedAdd,
  entities: readonly import("grammy/types").MessageEntity[] = [],
  opts: { receiptFileId?: string } = {},
) {
  const group = ctx.dbGroup;
  const payer = ctx.dbUser;

  // Auto-register people picked from the @ list who have no public username.
  //
  // A text_mention entity survives copy/paste and forwarding, so it can name
  // someone who was never in this chat, and a spurious group_members row
  // silently enlarges every equal split — hence the same getChatMember bar
  // /join uses. But it is only applied when the bot is an admin: a non-admin
  // bot can report `left` for a real member (see canVerifyMembership), and
  // refusing on that would break /add for every group that hasn't promoted the
  // bot — which deployment treats as the normal case. Unverifiable beats
  // wrongly-rejected here: /add's job is to record the expense.
  const namesByTelegramId = new Map<number, string>();
  let enforceMembership: boolean | null = null;
  for (const entity of entities) {
    if (entity.type !== "text_mention" || !entity.user || entity.user.is_bot) continue;
    namesByTelegramId.set(
      entity.user.id,
      labelUser({
        firstName: entity.user.first_name,
        lastName: entity.user.last_name ?? null,
        username: entity.user.username ?? null,
      }),
    );

    // Resolved lazily and once — the overwhelmingly common /add has no
    // text_mention at all and must not pay for an extra API round trip.
    if (enforceMembership === null) {
      enforceMembership = ctx.chat
        ? await canVerifyMembership(ctx.api, ctx.chat.id, ctx.me.id)
        : false;
    }
    if (enforceMembership && (await verifyInChat(ctx.api, ctx.chat!.id, entity.user.id)) !== "in") {
      continue;
    }

    const u = await upsertTelegramUser(entity.user);
    await db.insert(groupMembers).values({ groupId: group.id, userId: u.id }).onConflictDoNothing();
  }

  const resolved = await resolveParticipants(group.id, parsed, namesByTelegramId);
  if ("error" in resolved) {
    await ctx.reply(resolved.error);
    return;
  }
  if (resolved.participants.length === 0) {
    await ctx.reply("這個群組沒有可分帳的人。");
    return;
  }

  // One transaction: a half-written expense (payer credited, nobody debited)
  // would permanently skew computeGroupBalances.
  const expense = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(expenses)
      .values({
        groupId: group.id,
        amount: parsed.amount.toFixed(2),
        currency: parsed.currency ?? group.defaultCurrency,
        description: parsed.description,
        createdBy: payer.id,
        ...(opts.receiptFileId ? { receiptFileId: opts.receiptFileId } : {}),
      })
      .returning();
    await Promise.all([
      tx
        .insert(expensePayers)
        .values({ expenseId: row.id, payerId: payer.id, amount: parsed.amount.toFixed(2) }),
      tx.insert(expenseSplits).values(
        splitRowsFor(
          row.id,
          parsed.amount,
          resolved.participants.map((p) => ({ userId: p.id, weight: 1 })),
        ),
      ),
    ]);
    return row;
  });

  const card = await renderCard(originOf(ctx), expense.id, "default");
  if (card) {
    const sent = await ctx.reply(card.text, {
      parse_mode: "HTML",
      reply_markup: card.reply_markup,
    });
    // Bind the card to the expense so an edit made in the Mini App refreshes
    // *this* message instead of posting a second one (src/lib/notify.ts).
    await rememberNoticeMessage(expense.id, sent.message_id);
  }
}

/* ── /add ─────────────────────────────────────────────────────────────── */

addCommand.command("add", async (ctx) => {
  if (!ctx.dbGroup || !ctx.dbUser) {
    const keyboard = new InlineKeyboard().webApp(BTN.openApp, clientEnv.NEXT_PUBLIC_MINI_APP_URL);
    await ctx.reply(
      "分帳要在群組裡才有意義 — 把我加進群組就能用 /add 記帳。\n" +
        "想看自己現在的帳，可以直接開 App。",
      { reply_markup: keyboard },
    );
    return;
  }

  const cmdBody = (ctx.message?.text ?? "").replace(/^\/add(@\w+)?\s*/i, "");
  if (!cmdBody.trim()) {
    await prompt(ctx, PROMPT_NEW);
    return;
  }

  let parsed;
  try {
    parsed = parseAddMessage(ctx.message?.text ?? "", ctx.message?.entities ?? []);
  } catch (err) {
    await replyAddError(ctx, err instanceof Error ? err.message : ADD_USAGE);
    return;
  }

  await handleAddParsed(
    ctx as Parameters<typeof handleAddParsed>[0],
    parsed,
    ctx.message?.entities ?? [],
  );
});

/* ── receipt upload prompt ────────────────────────────────────────────── */

addCommand.callbackQuery(/^upload_receipt:(\d+)$/, async (ctx) => {
  const expenseId = Number(ctx.match[1]);

  if (!ctx.dbUser) {
    await ctx.answerCallbackQuery({ text: "無法識別使用者", show_alert: true });
    return;
  }

  const [expense] = await db.select().from(expenses).where(eq(expenses.id, expenseId));
  // Scoped to the group the callback came from — see deleteExpense.ts.
  if (!expense || !ctx.dbGroup || expense.groupId !== ctx.dbGroup.id) {
    await ctx.answerCallbackQuery({ text: "找不到這筆支出（可能已刪除）", show_alert: true });
    return;
  }

  const chatId = ctx.chat?.id;
  if (!chatId) {
    await ctx.answerCallbackQuery({ text: "無法取得群組資訊", show_alert: true });
    return;
  }

  // Mention the requester so `selective` actually targets them — replying to
  // the bot's own card would target nobody. See prompt() above.
  const sent = await ctx.reply(`${mentionRequester(ctx)} 請直接傳送收據照片 📷`, {
    parse_mode: "HTML",
    reply_markup: { force_reply: true, selective: true },
  });

  await db.insert(receiptAwaiting).values({ chatId, messageId: sent.message_id, expenseId });
  await ctx.answerCallbackQuery();
});

/* ── replies to ForceReply prompts ────────────────────────────────────── */

addCommand.on("message:text", async (ctx, next) => {
  if (!ctx.dbGroup || !ctx.dbUser) return next();

  const replyToId = ctx.message.reply_to_message?.message_id;
  if (!replyToId) return next();

  const [pending] = await db
    .select()
    .from(addAwaiting)
    .where(and(eq(addAwaiting.chatId, ctx.chat.id), eq(addAwaiting.messageId, replyToId)));

  if (!pending) return next();

  await Promise.all([
    db.delete(addAwaiting).where(eq(addAwaiting.id, pending.id)),
    db.delete(addAwaiting).where(lt(addAwaiting.createdAt, new Date(Date.now() - STALE_MS))),
    ctx.api.deleteMessage(ctx.chat.id, replyToId).catch(() => undefined),
  ]);

  if (pending.expenseId && pending.field) {
    await applyFieldReply(ctx, pending.expenseId, pending.field, pending.panelMessageId);
    return;
  }

  // A fresh /add: re-run the text through the parser as if it were typed inline.
  const syntheticText = "/add " + ctx.message.text;
  const syntheticEntities = (ctx.message.entities ?? []).map((e) => ({
    ...e,
    offset: e.offset + 5, // length of "/add "
  }));

  let parsed;
  try {
    parsed = parseAddMessage(syntheticText, syntheticEntities);
  } catch (err) {
    await replyAddError(ctx, err instanceof Error ? err.message : ADD_USAGE);
    return;
  }

  await handleAddParsed(
    ctx as Parameters<typeof handleAddParsed>[0],
    parsed,
    ctx.message.entities ?? [],
  );
});

/** Apply a ForceReply answer to one field of an existing expense, then refresh its card. */
async function applyFieldReply(
  ctx: BotContext & { chat: { id: number }; message: { text: string } },
  expenseId: number,
  field: string,
  panelMessageId: number | null,
) {
  const raw = ctx.message.text.trim();

  // No ownership check, matching the panel buttons this prompt was raised from —
  // but the same group scoping they apply (see expensePanel.ts's guard).
  const [target] = await db
    .select({ id: expenses.id, groupId: expenses.groupId, currency: expenses.currency })
    .from(expenses)
    .where(eq(expenses.id, expenseId));
  if (!target || !ctx.dbGroup || target.groupId !== ctx.dbGroup.id) {
    await ctx.reply("找不到這筆支出（可能已刪除）。");
    return;
  }

  if (field === "amount") {
    const value = evalAmountExpr(raw);
    if (value === null || value <= 0) {
      await ctx.reply(`看不懂金額「${raw}」，金額沒有改。`);
      return;
    }
    await setExpenseAmount(expenseId, value);
  } else if (field === "currency") {
    const code = raw.toUpperCase();
    // Must be a currency the whole app supports: an unknown code makes getRate
    // fail, which takes down /balance and /settle for the entire group.
    if (!isSupportedCurrency(code)) {
      await ctx.reply(
        `「${raw}」不是支援的幣別，幣別沒有改。\n目前支援：${SUPPORTED_CURRENCIES.join(" / ")}`,
      );
      return;
    }
    // Only when it actually changes: a pinned rate belongs to the old currency,
    // but re-typing the current code must not discard one. Same guard as the
    // 💱 buttons in expensePanel.ts.
    if (target.currency !== code) {
      await db
        .update(expenses)
        .set({ currency: code, fxRate: null, fxQuote: null, updatedAt: new Date() })
        .where(eq(expenses.id, expenseId));
    }
  }

  const card = await renderCard(originOf(ctx), expenseId, "adjust");
  if (!card || !panelMessageId) return;
  await ctx.api
    .editMessageText(ctx.chat.id, panelMessageId, card.text, {
      parse_mode: "HTML",
      reply_markup: card.reply_markup,
    })
    .catch(() => undefined);
}
