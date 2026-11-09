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
import { BTN, button, TOAST } from "@/lib/buttons";
import type { Group } from "@/db/schema";
import { telegramChatId } from "@/lib/chat";
import { expenseLink } from "@/lib/deep-link";
import { fmtGrouped } from "@/lib/money";
import { labelUser } from "@/lib/label";
import {
  ADD_USAGE,
  evalAmountExpr,
  isSupportedCurrency,
  parseAddMessage,
  type ParsedAdd,
} from "@/lib/parseAdd";
import { logCreated } from "@/lib/record-mutation";
import { SUPPORTED_CURRENCIES } from "@/lib/zod";

import { loadGroupMembers, originOf, renderCard, splitRowsFor, type DbUser } from "../expenseCard";
import { setExpenseAmount, setExpenseCurrency } from "../expenseEdits";
import { actorOf } from "../actor";
import { spentAtForNow } from "@/lib/fx";
import { escapeHtml, mention } from "../format";
import { staleAwaitingBefore } from "../awaiting";
import { USER_COLUMNS } from "../profiles";
import { openAppKeyboard } from "../groupViews";
import { pickGroup, quotedTitle } from "../groupPicker";
import { canVerifyMembership, verifyInChat } from "../membership";
import type { BotContext } from "../context";

export const addCommand = new Composer<BotContext>();

const PROMPT_NEW = "要記什麼？直接回覆「金額 說明」👇\n例如 500 晚餐、3000 JPY 拉麵";

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
        labelUser({
          displayName: ctx.dbUser?.displayName ?? null,
          firstName: from.first_name,
          lastName: from.last_name ?? null,
          username: null,
        }),
        from.id,
      );
}

/** Report a parse failure and immediately offer a one-tap retry. */
async function replyAddError(ctx: BotContext, message: string) {
  await prompt(ctx, `${message}\n👇 回覆這則重打`);
}

export async function promptForExpenseField(
  ctx: BotContext,
  expenseId: number,
  field: "amount" | "currency",
  panelMessageId: number,
) {
  const text =
    field === "amount"
      ? "新金額？👇 回覆這則"
      : `幣別代碼？👇 回覆這則\n可用：${SUPPORTED_CURRENCIES.join(" ")}`;
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
    .select(USER_COLUMNS)
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
        `${missing.join("、")} 還沒加入揪帳，這筆沒記。\n` +
        "回覆他的訊息打 /join 加入後再記一次。",
    };
  }
  return { participants: found };
}

/**
 * Create the expense and post its card. Shared by the text command, the
 * ForceReply path and the photo-caption path in receiptUpload.ts.
 */
export async function handleAddParsed(
  ctx: BotContext & { dbUser: NonNullable<BotContext["dbUser"]> },
  parsed: ParsedAdd,
  entities: readonly import("grammy/types").MessageEntity[] = [],
  /** `group` is set for an /add typed in a private chat, which belongs to no group. */
  opts: { receiptFileId?: string; group?: Group } = {},
) {
  const group = opts.group ?? ctx.dbGroup!;
  const inPrivate = !ctx.dbGroup;
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
  // A private chat has no members to check a mention against, so there it only matches
  // people already in the group.
  for (const entity of inPrivate ? [] : entities) {
    if (entity.type !== "text_mention" || !entity.user || entity.user.is_bot) continue;
    namesByTelegramId.set(
      entity.user.id,
      // Telegram's own name: it only names someone who couldn't be added, who may have no row.
      labelUser({
        displayName: null,
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
    await ctx.reply(`還沒有人加入揪帳，點「${BTN.openApp}」加入後再記。`, {
      reply_markup: openAppKeyboard(group, { botUsername: ctx.me.username, inPrivate }),
    });
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
        // Today in the group's zone: the day the rate is looked up for.
        spentAt: spentAtForNow(group.timezone),
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

  if (inPrivate) {
    // Posted to the group like a record made in the app (its card goes to the group's
    // chat, if it has one); the private chat gets a confirmation.
    await logCreated(ctx.api, expense.id, actorOf(ctx));
    await replyPrivateConfirmation(ctx, group, expense.id);
    return;
  }

  const card = await renderCard(originOf(ctx), expense.id, "default");
  const sent = card
    ? await ctx.reply(card.text, { parse_mode: "HTML", reply_markup: card.reply_markup })
    : undefined;

  // `null` api: the card above *is* this record's group message, so binding its
  // id is all the notify side needs — sending another would duplicate it.
  await logCreated(null, expense.id, actorOf(ctx), { messageId: sent?.message_id });
}

/**
 * "✓ 已記到「東京旅行」" over the same lines the group's card shows. No ☰ 調整 panel: its
 * buttons work out the group from the chat they are pressed in, and this chat has none.
 * ⊗ 刪除 still works here (`deleteExpense.ts` checks membership in a private chat).
 */
async function replyPrivateConfirmation(ctx: BotContext, group: Group, expenseId: number) {
  const chatId = telegramChatId(group);
  const card = await renderCard(
    { botUsername: ctx.me.username, chatId: chatId ?? 0 },
    expenseId,
    "default",
  );
  if (!card) return;
  const kb = new InlineKeyboard();
  if (chatId !== null) kb.url(button("appEdit"), expenseLink(ctx.me.username, chatId, expenseId));
  else kb.webApp(button("appEdit"), clientEnv.NEXT_PUBLIC_MINI_APP_URL);
  kb.text(button("delete"), `del_exp:${expenseId}`);
  await ctx.reply(`✓ 已記到${quotedTitle(group)}\n${card.text}`, {
    parse_mode: "HTML",
    reply_markup: kb,
  });
}

/**
 * A private `/add`: parsed first, so a typo is caught before asking which group. With one
 * group it is recorded straight away; with several, the picker's callback
 * (`privatePick.ts`) records it once a group is chosen.
 */
export async function privateAdd(ctx: BotContext & { dbUser: NonNullable<BotContext["dbUser"]> }) {
  const text = ctx.message?.text ?? "";
  if (!text.replace(/^\/add(@\w+)?\s*/i, "").trim()) {
    await ctx.reply(ADD_USAGE);
    return;
  }
  let parsed;
  try {
    parsed = parseAddMessage(text, ctx.message?.entities ?? []);
  } catch (err) {
    await ctx.reply(err instanceof Error ? err.message : ADD_USAGE);
    return;
  }

  const desc = parsed.description ? `${escapeHtml(parsed.description)}　` : "";
  const money = `${fmtGrouped(parsed.amount)}${parsed.currency ? ` ${parsed.currency}` : ""}`;
  const group = await pickGroup(ctx, "add", `<b>${desc}${money}</b> 要記到哪個群組？`);
  if (group) await handleAddParsed(ctx, parsed, [], { group });
}

/* ── /add ─────────────────────────────────────────────────────────────── */

addCommand.command("add", async (ctx) => {
  if (!ctx.dbUser) return;
  if (!ctx.dbGroup) {
    if (ctx.chat.type === "private") await privateAdd(ctx as Parameters<typeof privateAdd>[0]);
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
    await ctx.answerCallbackQuery({ text: TOAST.unknownUser, show_alert: true });
    return;
  }

  const [expense] = await db.select().from(expenses).where(eq(expenses.id, expenseId));
  // Scoped to the group the callback came from — see deleteExpense.ts.
  if (!expense || !ctx.dbGroup || expense.groupId !== ctx.dbGroup.id) {
    await ctx.answerCallbackQuery({ text: TOAST.recordGone, show_alert: true });
    return;
  }

  const chatId = ctx.chat?.id;
  if (!chatId) {
    await ctx.answerCallbackQuery({ text: TOAST.actionFailed, show_alert: true });
    return;
  }

  // Mention the requester so `selective` actually targets them — replying to
  // the bot's own card would target nobody. See prompt() above.
  const sent = await ctx.reply(`${mentionRequester(ctx)} 📷 回覆這則，傳一張收據照片`, {
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
    db.delete(addAwaiting).where(lt(addAwaiting.createdAt, staleAwaitingBefore())),
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

/** A rejected field reply: say why and ask again, like a failed /add does. */
async function retryField(
  ctx: BotContext,
  message: string,
  expenseId: number,
  field: string,
  panelMessageId: number | null,
) {
  await prompt(ctx, `${message}\n👇 回覆這則重打`, {
    expenseId,
    field,
    panelMessageId: panelMessageId ?? undefined,
  });
}

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
    await ctx.reply(TOAST.recordGone);
    return;
  }

  if (field === "amount") {
    const value = evalAmountExpr(raw);
    if (value === null || value <= 0) {
      await retryField(ctx, `看不懂「${raw}」，金額沒改`, expenseId, field, panelMessageId);
      return;
    }
    await setExpenseAmount(expenseId, value, actorOf(ctx));
  } else if (field === "currency") {
    const code = raw.toUpperCase();
    // Must be a currency the whole app supports: an unknown code makes getRate
    // fail, which takes down /balance and /settle for the entire group.
    if (!isSupportedCurrency(code)) {
      await retryField(
        ctx,
        `不支援「${raw}」，幣別沒改\n可用：${SUPPORTED_CURRENCIES.join(" ")}`,
        expenseId,
        field,
        panelMessageId,
      );
      return;
    }
    // Shared with the 幣別 buttons: re-typing the current code must not discard a
    // pinned rate, and a real change must always drop it.
    await setExpenseCurrency(expenseId, code, actorOf(ctx));
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
