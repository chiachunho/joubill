import { Composer } from "grammy";
import { and, eq, inArray, or } from "drizzle-orm";

import { db } from "@/db";
import { expenseSplits, expenses, groupMembers, users } from "@/db/schema";
import { splitEqual } from "@/lib/money";
import { parseAddMessage } from "@/lib/parseAdd";

import type { BotContext } from "../context";

export const addCommand = new Composer<BotContext>();

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

  // Resolve participants. With @-mentions (regular or text_mention) -> exactly
  // those users. Without any mention -> all current group members.
  const hasMentions =
    parsed.mentionUsernames.length > 0 || parsed.mentionTelegramIds.length > 0;
  let participants: { id: number; username: string | null; firstName: string }[];
  if (hasMentions) {
    const conditions = [];
    if (parsed.mentionUsernames.length > 0) {
      conditions.push(inArray(users.username, parsed.mentionUsernames));
    }
    if (parsed.mentionTelegramIds.length > 0) {
      conditions.push(inArray(users.telegramId, parsed.mentionTelegramIds));
    }
    const found = await db
      .select({
        id: users.id,
        username: users.username,
        firstName: users.firstName,
        telegramId: users.telegramId,
      })
      .from(users)
      .innerJoin(groupMembers, eq(groupMembers.userId, users.id))
      .where(and(eq(groupMembers.groupId, group.id), or(...conditions)));

    const foundUsernames = new Set(found.map((u) => u.username));
    const foundTelegramIds = new Set(found.map((u) => u.telegramId));
    const missingUsernames = parsed.mentionUsernames.filter((u) => !foundUsernames.has(u));
    const missingTelegramIds = parsed.mentionTelegramIds.filter(
      (id) => !foundTelegramIds.has(id),
    );
    if (missingUsernames.length > 0 || missingTelegramIds.length > 0) {
      const missingLabels = [
        ...missingUsernames.map((u) => "@" + u),
        ...missingTelegramIds.map((id) => `(tg:${id})`),
      ];
      await ctx.reply(
        `找不到群組裡的這些人：${missingLabels.join(", ")}\n` +
          `（被 @ 的人需先在這個群組講過話一次以註冊）`,
      );
      return;
    }
    participants = found;
  } else {
    participants = await db
      .select({ id: users.id, username: users.username, firstName: users.firstName })
      .from(users)
      .innerJoin(groupMembers, eq(groupMembers.userId, users.id))
      .where(eq(groupMembers.groupId, group.id));
  }

  if (participants.length === 0) {
    await ctx.reply("這個群組沒有可分帳的人。");
    return;
  }

  const shares = splitEqual(parsed.amount, participants.length);

  // Insert expense, then splits. neon-http has no transaction; if splits fail
  // mid-way the orphan expense has no effect on balances (the join below filters
  // by groupId AND requires matching splits).
  const [expense] = await db
    .insert(expenses)
    .values({
      groupId: group.id,
      payerId: payer.id,
      amount: parsed.amount.toFixed(2),
      currency: group.defaultCurrency,
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

  const names = participants.map((p) => p.username ?? p.firstName).join(", ");
  await ctx.reply(
    `已記下 #${expense.id}\n` +
      `${payer.firstName} 付 ${parsed.amount.toFixed(2)} ${group.defaultCurrency}` +
      (parsed.description ? `（${parsed.description}）` : "") +
      `\n分給 ${participants.length} 人：${names}\n` +
      `每人 ${shares[0].toFixed(2)} ${group.defaultCurrency}` +
      (shares.some((s) => s !== shares[0]) ? "（含尾數調整）" : ""),
  );
});
