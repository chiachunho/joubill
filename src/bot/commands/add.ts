import { Composer, InlineKeyboard } from "grammy";
import { and, eq, inArray, or } from "drizzle-orm";

import { db } from "@/db";
import { expenseSplits, expenses, groupMembers, users } from "@/db/schema";
import { upsertTelegramUser } from "@/lib/auth/upsertTelegramUser";
import { fmt, splitEqual } from "@/lib/money";
import { parseAddMessage, type ShareLine } from "@/lib/parseAdd";
import { serverEnv } from "@/lib/env";

import type { BotContext } from "../context";

export const addCommand = new Composer<BotContext>();

type DbUser = { id: number; username: string | null; firstName: string; telegramId: number | null };

/** Resolve a share line person to a group member row. Returns null if not found. */
async function resolveSharePerson(
  share: ShareLine,
  selfUser: DbUser,
  groupId: number,
): Promise<DbUser | null> {
  if (share.type === "self") return selfUser;

  const baseQuery = db
    .select({ id: users.id, username: users.username, firstName: users.firstName, telegramId: users.telegramId })
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
    // Resolve each share line to a DB user
    const resolved: Array<{ user: DbUser; amount: number }> = [];
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
      resolved.push({ user, amount: share.amount });
    }

    const specifiedIds = new Set(resolved.map((r) => r.user.id));
    const totalSpecified = resolved.reduce((s, r) => s + r.amount, 0);

    let expenseTotal: number;
    const splitRows: Array<{ debtorId: number; amount: string; shareType: string }> = resolved.map(
      (r) => ({ debtorId: r.user.id, amount: r.amount.toFixed(2), shareType: "exact" }),
    );
    const splitLabels: string[] = resolved.map(
      (r) => `${r.user.username ? "@" + r.user.username : r.user.firstName} ${fmt(r.amount)}`,
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
          .select({ id: users.id, username: users.username, firstName: users.firstName, telegramId: users.telegramId })
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
          splitLabels.push(`${u.username ? "@" + u.username : u.firstName} ${fmt(remainderShares[i])}`);
        });
      }
    } else {
      // Plan B: total = sum of specified shares
      expenseTotal = totalSpecified;
    }

    const [expense] = await db
      .insert(expenses)
      .values({
        groupId: group.id,
        payerId: payer.id,
        amount: expenseTotal.toFixed(2),
        currency,
        description: parsed.description,
        createdBy: payer.id,
      })
      .returning();

    await db.insert(expenseSplits).values(
      splitRows.map((r) => ({ expenseId: expense.id, debtorId: r.debtorId, amount: r.amount, shareType: r.shareType })),
    );

    const descPart = parsed.description ? `（${parsed.description}）` : "";
    const text =
      `${payer.firstName} 付了 ${fmt(expenseTotal)} ${currency}${descPart}\n` +
      splitLabels.join("、");

    await ctx.reply(text, { reply_markup: buildKeyboard(ctx, expense.id) });
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
      .select({ id: users.id, username: users.username, firstName: users.firstName, telegramId: users.telegramId })
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
      .select({ id: users.id, username: users.username, firstName: users.firstName, telegramId: users.telegramId })
      .from(users)
      .innerJoin(groupMembers, eq(groupMembers.userId, users.id))
      .where(eq(groupMembers.groupId, group.id));
  }

  if (participants.length === 0) {
    await ctx.reply("這個群組沒有可分帳的人。");
    return;
  }

  const amount = parsed.amount!;
  const shares = splitEqual(amount, participants.length);

  const [expense] = await db
    .insert(expenses)
    .values({
      groupId: group.id,
      payerId: payer.id,
      amount: amount.toFixed(2),
      currency,
      description: parsed.description,
      createdBy: payer.id,
    })
    .returning();

  await db.insert(expenseSplits).values(
    participants.map((p, i) => ({
      expenseId: expense.id,
      debtorId: p.id,
      amount: shares[i].toFixed(2),
      shareType: "equal" as const,
    })),
  );

  const descPart = parsed.description ? `（${parsed.description}）` : "";
  const allSame = shares.every((s) => s === shares[0]);
  const splitLine = allSame
    ? `${participants.map((p) => p.username ?? p.firstName).join("、")} 各 ${fmt(shares[0])}`
    : participants.map((p, i) => `${p.username ?? p.firstName} ${fmt(shares[i])}`).join("、");
  const text =
    `${payer.firstName} 付了 ${fmt(amount)} ${currency}${descPart}\n` + splitLine;

  await ctx.reply(text, { reply_markup: buildKeyboard(ctx, expense.id) });
});

function buildKeyboard(ctx: BotContext, expenseId: number): InlineKeyboard {
  const botUsername = ctx.me.username;
  const appName = serverEnv().TELEGRAM_MINI_APP_NAME;
  const chatId = ctx.chat?.id;
  const editUrl = `https://t.me/${botUsername}/${appName}?startapp=group_${chatId}_exp_${expenseId}`;

  return new InlineKeyboard()
    .url("編輯", editUrl)
    .text("刪除", `del_exp:${expenseId}`);
}
