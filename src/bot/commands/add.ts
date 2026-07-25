import { Composer, InlineKeyboard } from "grammy";
import { and, eq, inArray, lt, or } from "drizzle-orm";

import { db } from "@/db";
import { addAwaiting, expensePayers, expenses, groupMembers, receiptAwaiting, users } from "@/db/schema";
import { upsertTelegramUser } from "@/lib/auth/upsertTelegramUser";
import { clientEnv } from "@/lib/env";
import { ADD_USAGE, evalAmountExpr, parseAddMessage, type ParsedAdd } from "@/lib/parseAdd";

import {
  loadGroupMembers,
  renderCard,
  setExpenseAmount,
  writeSplits,
  type DbUser,
} from "../expenseCard";
import type { BotContext } from "../context";

export const addCommand = new Composer<BotContext>();

const PROMPT_NEW = `${ADD_USAGE}\n\n👇 直接回覆這則訊息`;

/** Rows older than 24 h are no longer actionable — cleaned up opportunistically. */
const STALE_MS = 24 * 60 * 60 * 1000;

/**
 * Send a ForceReply prompt and remember it, so the user's reply lands back in
 * the right place. `expenseId`/`field` are set when the reply edits an existing
 * expense instead of creating a new one.
 */
async function prompt(
  ctx: BotContext,
  text: string,
  extra: { expenseId?: number; field?: string; panelMessageId?: number } = {},
) {
  const sent = await ctx.reply(text, {
    reply_to_message_id: ctx.message?.message_id ?? ctx.callbackQuery?.message?.message_id,
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
      : "輸入幣別代碼（三個英文字母，例如 JPY）";
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
    ...parsed.mentionTelegramIds.filter((id) => !foundTelegramIds.has(id)).map(() => "（某位成員）"),
  ];

  if (missing.length > 0) {
    return {
      error:
        `找不到群組裡的 ${missing.join("、")}。\n` +
        `Telegram 不讓我用 @username 反查使用者，對方要先在這個群組講過一句話。\n` +
        `或者先「/add 500 晚餐」記起來，再用「⚙️ 調整 → 👥 誰分」挑人。`,
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
  for (const entity of entities) {
    if (entity.type !== "text_mention" || !entity.user || entity.user.is_bot) continue;
    const u = await upsertTelegramUser(entity.user);
    await db.insert(groupMembers).values({ groupId: group.id, userId: u.id }).onConflictDoNothing();
  }

  const resolved = await resolveParticipants(group.id, parsed);
  if ("error" in resolved) {
    await ctx.reply(resolved.error);
    return;
  }
  if (resolved.participants.length === 0) {
    await ctx.reply("這個群組沒有可分帳的人。");
    return;
  }

  const [expense] = await db
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

  await db
    .insert(expensePayers)
    .values({ expenseId: expense.id, payerId: payer.id, amount: parsed.amount.toFixed(2) });
  await writeSplits(
    expense.id,
    parsed.amount,
    resolved.participants.map((p) => ({ userId: p.id, weight: 1 })),
  );

  const card = await renderCard(ctx, expense.id, "default");
  if (card) await ctx.reply(card.text, { parse_mode: "HTML", reply_markup: card.reply_markup });
}

/* ── /add ─────────────────────────────────────────────────────────────── */

addCommand.command("add", async (ctx) => {
  if (!ctx.dbGroup || !ctx.dbUser) {
    const keyboard = new InlineKeyboard().webApp("開啟揪帳", clientEnv.NEXT_PUBLIC_MINI_APP_URL);
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
    parsed = parseAddMessage(ctx.message?.text ?? "", ctx.message?.entities ?? [], {
      currencies: [ctx.dbGroup.defaultCurrency],
    });
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
  if (!expense) {
    await ctx.answerCallbackQuery({ text: "找不到這筆支出（可能已刪除）", show_alert: true });
    return;
  }

  const chatId = ctx.chat?.id;
  if (!chatId) {
    await ctx.answerCallbackQuery({ text: "無法取得群組資訊", show_alert: true });
    return;
  }

  const sent = await ctx.reply("請直接傳送收據照片 📷", {
    reply_to_message_id: ctx.callbackQuery.message?.message_id,
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
    parsed = parseAddMessage(syntheticText, syntheticEntities, {
      currencies: [ctx.dbGroup.defaultCurrency],
    });
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

  if (field === "amount") {
    const value = evalAmountExpr(raw);
    if (value === null || value <= 0) {
      await ctx.reply(`看不懂金額「${raw}」，金額沒有改。`);
      return;
    }
    await setExpenseAmount(expenseId, value);
  } else if (field === "currency") {
    const code = raw.toUpperCase();
    if (!/^[A-Z]{3}$/.test(code)) {
      await ctx.reply(`「${raw}」不是幣別代碼，要三個英文字母（例如 JPY），幣別沒有改。`);
      return;
    }
    // A pinned rate belongs to the old currency — drop it rather than let it
    // silently apply to the new one.
    await db
      .update(expenses)
      .set({ currency: code, fxRate: null, fxQuote: null, updatedAt: new Date() })
      .where(eq(expenses.id, expenseId));
  }

  const card = await renderCard(ctx, expenseId, "adjust");
  if (!card || !panelMessageId) return;
  await ctx.api
    .editMessageText(ctx.chat.id, panelMessageId, card.text, {
      parse_mode: "HTML",
      reply_markup: card.reply_markup,
    })
    .catch(() => undefined);
}
