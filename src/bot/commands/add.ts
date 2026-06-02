import { Composer, InlineKeyboard } from "grammy";
import { and, eq, inArray, or } from "drizzle-orm";

import { db } from "@/db";
import { expensePayers, expenseSplits, expenses, groupMembers, receiptAwaiting, users } from "@/db/schema";
import { upsertTelegramUser } from "@/lib/auth/upsertTelegramUser";
import { labelUser } from "@/lib/label";
import { fmtGrouped, splitEqual } from "@/lib/money";
import { parseAddMessage, type ShareLine } from "@/lib/parseAdd";
import { serverEnv } from "@/lib/env";

import { escapeHtml, mention } from "../format";
import type { BotContext } from "../context";

export const addCommand = new Composer<BotContext>();

export type DbUser = {
  id: number;
  username: string | null;
  firstName: string;
  lastName: string | null;
  telegramId: number | null;
};

/**
 * Name for the result message (HTML). Echoes a plain "@username" when the user
 * actually typed that @mention (Telegram auto-links it); otherwise renders the
 * display name as a tappable tg://user inline mention.
 */
function nameFor(u: DbUser, typedAt: boolean): string {
  return typedAt && u.username ? "@" + u.username : mention(labelUser(u), u.telegramId);
}

/** Resolve a share line person to a group member row. Returns null if not found. */
async function resolveSharePerson(
  share: ShareLine,
  selfUser: DbUser,
  groupId: number,
): Promise<DbUser | null> {
  if (share.type === "self") return selfUser;

  const baseQuery = db
    .select({ id: users.id, username: users.username, firstName: users.firstName, lastName: users.lastName, telegramId: users.telegramId })
    .from(users)
    .innerJoin(groupMembers, eq(groupMembers.userId, users.id))
    .$dynamic();

  if (share.type === "username") {
    const [row] = await baseQuery.where(
      and(eq(groupMembers.groupId, groupId), eq(users.username, share.username)),
    );
    return row ?? null;
  }

  // telegramId
  const [row] = await baseQuery.where(
    and(eq(groupMembers.groupId, groupId), eq(users.telegramId, share.telegramId)),
  );
  return row ?? null;
}

addCommand.command("add", async (ctx) => {
  if (!ctx.dbGroup || !ctx.dbUser) {
    await ctx.reply("這個指令只能在群組裡用，把我加進群組再試。");
    return;
  }

  let parsed;
  try {
    parsed = parseAddMessage(ctx.message?.text ?? "", ctx.message?.entities ?? []);
  } catch (err) {
    await ctx.reply(err instanceof Error ? err.message : "輸入格式錯誤");
    return;
  }

  const group = ctx.dbGroup;
  const payer = ctx.dbUser;

  // Auto-register text_mention users (people without @username picked from mention list)
  for (const entity of ctx.message?.entities ?? []) {
    if (entity.type !== "text_mention" || !entity.user || entity.user.is_bot) continue;
    const u = await upsertTelegramUser(entity.user);
    await db.insert(groupMembers).values({ groupId: group.id, userId: u.id }).onConflictDoNothing();
  }

  const currency = group.defaultCurrency;

  // ── Unequal split (multi-line) ─────────────────────────────────────────────
  if (parsed.shareLines.length > 0) {
    // Resolve each share line to a DB user. typedAt marks people the user
    // wrote as @username (so the result echoes the @), vs 我 / @-list picks.
    const resolved: Array<{ user: DbUser; amount: number; typedAt: boolean }> = [];
    for (const share of parsed.shareLines) {
      const user = await resolveSharePerson(share, payer, group.id);
      if (!user) {
        const label =
          share.type === "username"
            ? "@" + share.username
            : share.type === "telegramId"
              ? `(tg:${share.telegramId})`
              : "我";
        await ctx.reply(
          `找不到群組成員：${label}\n` +
            `對方需要先在群組裡講過話，或被重新加進群組。`,
        );
        return;
      }
      resolved.push({ user, amount: share.amount, typedAt: share.type === "username" });
    }

    const specifiedIds = new Set(resolved.map((r) => r.user.id));
    const totalSpecified = resolved.reduce((s, r) => s + r.amount, 0);

    let expenseTotal: number;
    const splitRows: Array<{ debtorId: number; amount: string; shareType: string }> = resolved.map(
      (r) => ({ debtorId: r.user.id, amount: r.amount.toFixed(2), shareType: "exact" }),
    );
    const splitLabels: string[] = resolved.map(
      (r) => `${nameFor(r.user, r.typedAt)} ${fmtGrouped(r.amount)}`,
    );

    if (parsed.amount !== null) {
      // Plan A: total given → split remainder among unspecified group members
      expenseTotal = parsed.amount;
      const remainder = Math.round((expenseTotal - totalSpecified) * 100) / 100;

      if (remainder < -0.005) {
        await ctx.reply(
          `各人金額合計 ${totalSpecified.toFixed(2)} 超過總金額 ${expenseTotal.toFixed(2)}`,
        );
        return;
      }

      if (remainder > 0.005) {
        const allMembers = await db
          .select({ id: users.id, username: users.username, firstName: users.firstName, lastName: users.lastName, telegramId: users.telegramId })
          .from(users)
          .innerJoin(groupMembers, eq(groupMembers.userId, users.id))
          .where(eq(groupMembers.groupId, group.id));

        const unspecified = allMembers.filter((m) => !specifiedIds.has(m.id));

        if (unspecified.length === 0) {
          await ctx.reply(
            `各人金額合計 ${totalSpecified.toFixed(2)}，剩餘 ${remainder.toFixed(2)} 無人可平分（所有成員都已指定金額）`,
          );
          return;
        }

        const remainderShares = splitEqual(remainder, unspecified.length);
        unspecified.forEach((u, i) => {
          splitRows.push({ debtorId: u.id, amount: remainderShares[i].toFixed(2), shareType: "equal" });
          splitLabels.push(`${nameFor(u, false)} ${fmtGrouped(remainderShares[i])}`);
        });
      }
    } else {
      // Plan B: total = sum of specified shares
      expenseTotal = totalSpecified;
    }

    const expense = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(expenses)
        .values({
          groupId: group.id,
          amount: expenseTotal.toFixed(2),
          currency,
          description: parsed.description,
          createdBy: payer.id,
        })
        .returning();
      await Promise.all([
        tx.insert(expensePayers).values({ expenseId: row.id, payerId: payer.id, amount: expenseTotal.toFixed(2) }),
        tx.insert(expenseSplits).values(
          splitRows.map((r) => ({ expenseId: row.id, debtorId: r.debtorId, amount: r.amount, shareType: r.shareType })),
        ),
      ]);
      return row;
    });

    const descPart = parsed.description ? `（${escapeHtml(parsed.description)}）` : "";
    const text =
      `${mention(labelUser(payer), payer.telegramId)} 付了 ` +
      `<b>${fmtGrouped(expenseTotal)} ${currency}</b>${descPart}\n` +
      splitLabels.join("、");

    await ctx.reply(text, { parse_mode: "HTML", reply_markup: buildKeyboard(ctx, expense.id, { showReceiptButton: true }) });
    return;
  }

  // ── Equal split (single-line) ──────────────────────────────────────────────
  const hasMentions =
    parsed.mentionUsernames.length > 0 || parsed.mentionTelegramIds.length > 0;

  let participants: DbUser[];
  if (hasMentions) {
    const conditions = [];
    if (parsed.mentionUsernames.length > 0)
      conditions.push(inArray(users.username, parsed.mentionUsernames));
    if (parsed.mentionTelegramIds.length > 0)
      conditions.push(inArray(users.telegramId, parsed.mentionTelegramIds));

    const found = await db
      .select({ id: users.id, username: users.username, firstName: users.firstName, lastName: users.lastName, telegramId: users.telegramId })
      .from(users)
      .innerJoin(groupMembers, eq(groupMembers.userId, users.id))
      .where(and(eq(groupMembers.groupId, group.id), or(...conditions)));

    const foundUsernames = new Set(found.map((u) => u.username));
    const foundTelegramIds = new Set(found.map((u) => u.telegramId));
    const missingUsernames = parsed.mentionUsernames.filter((u) => !foundUsernames.has(u));
    const missingTelegramIds = parsed.mentionTelegramIds.filter((id) => !foundTelegramIds.has(id));

    if (missingUsernames.length > 0 || missingTelegramIds.length > 0) {
      const missingLabels = [
        ...missingUsernames.map((u) => "@" + u),
        ...missingTelegramIds.map((id) => `(tg:${id})`),
      ];
      await ctx.reply(
        `找不到群組裡的這些人：${missingLabels.join(", ")}\n\n` +
          `Telegram 不允許我用 @username 反查使用者，所以對方需要先「被我看到」一次：\n` +
          `• 在這個群組講一句話，或\n` +
          `• 被重新加進群組，或\n` +
          `• 改用沒有 username 的 mention（從 @ 清單選人）\n` +
          `之後再 /add 就找得到了。`,
      );
      return;
    }
    participants = found;
  } else {
    participants = await db
      .select({ id: users.id, username: users.username, firstName: users.firstName, lastName: users.lastName, telegramId: users.telegramId })
      .from(users)
      .innerJoin(groupMembers, eq(groupMembers.userId, users.id))
      .where(eq(groupMembers.groupId, group.id));
  }

  if (participants.length === 0) {
    await ctx.reply("這個群組沒有可分帳的人。");
    return;
  }

  const amount = parsed.amount!;
  const { expense, shares } = await insertEqualSplitExpense({
    groupId: group.id,
    payerId: payer.id,
    createdBy: payer.id,
    amount,
    currency,
    description: parsed.description,
    participants,
  });

  // Echo "@username" only for people the user actually @-mentioned.
  const typedUsernames = new Set(parsed.mentionUsernames);
  const display = (p: DbUser) => nameFor(p, p.username ? typedUsernames.has(p.username) : false);

  const descPart = parsed.description ? `（${escapeHtml(parsed.description)}）` : "";
  const allSame = shares.every((s) => s === shares[0]);
  const splitLine = allSame
    ? `${participants.map(display).join("、")} 各 ${fmtGrouped(shares[0])}`
    : participants.map((p, i) => `${display(p)} ${fmtGrouped(shares[i])}`).join("、");
  const text =
    `${mention(labelUser(payer), payer.telegramId)} 付了 ` +
    `<b>${fmtGrouped(amount)} ${currency}</b>${descPart}\n` +
    splitLine;

  await ctx.reply(text, { parse_mode: "HTML", reply_markup: buildKeyboard(ctx, expense.id, { showReceiptButton: true }) });
});

export function buildKeyboard(
  ctx: BotContext,
  expenseId: number,
  opts: { showReceiptButton?: boolean } = {},
): InlineKeyboard {
  const { showReceiptButton = false } = opts;
  const botUsername = ctx.me.username;
  const appName = serverEnv().TELEGRAM_MINI_APP_NAME;
  const chatId = ctx.chat?.id;
  const editUrl = `https://t.me/${botUsername}/${appName}?startapp=group_${chatId}_exp_${expenseId}`;

  const kb = new InlineKeyboard().url("編輯", editUrl);
  if (showReceiptButton) kb.text("上傳收據", `upload_receipt:${expenseId}`);
  return kb.text("刪除", `del_exp:${expenseId}`);
}

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

  const sent = await ctx.reply("請回覆這則訊息並附上收據照片 📷", {
    reply_markup: { force_reply: true, selective: true },
  });

  await db.insert(receiptAwaiting).values({ chatId, messageId: sent.message_id, expenseId });
  await ctx.answerCallbackQuery();
});

/** Inserts an expense + equal splits in one call. Returns the created expense and share amounts. */
export async function insertEqualSplitExpense(params: {
  groupId: number;
  payerId: number;
  createdBy: number;
  amount: number;
  currency: string;
  description: string | null;
  participants: DbUser[];
  receiptFileId?: string | null;
}) {
  const { groupId, payerId, createdBy, amount, currency, description, participants, receiptFileId } =
    params;
  const shares = splitEqual(amount, participants.length);
  const expense = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(expenses)
      .values({
        groupId,
        amount: amount.toFixed(2),
        currency,
        description,
        createdBy,
        ...(receiptFileId !== undefined && { receiptFileId }),
      })
      .returning();
    await Promise.all([
      tx.insert(expensePayers).values({ expenseId: row.id, payerId, amount: amount.toFixed(2) }),
      tx.insert(expenseSplits).values(
        participants.map((p, i) => ({
          expenseId: row.id,
          debtorId: p.id,
          amount: shares[i].toFixed(2),
          shareType: "equal" as const,
        })),
      ),
    ]);
    return row;
  });
  return { expense, shares };
}

