import { Composer } from "grammy";
import { inArray } from "drizzle-orm";

import { db } from "@/db";
import { users } from "@/db/schema";
import { labelUser } from "@/lib/label";
import { fmtGrouped } from "@/lib/money";
import { computeGroupBalances } from "@/lib/settlement";

import { escapeHtml } from "../format";
import type { BotContext } from "../context";

export const balanceCommand = new Composer<BotContext>();

balanceCommand.command("balance", async (ctx) => {
  if (!ctx.dbGroup) {
    await ctx.reply("這個指令只能在群組裡用。");
    return;
  }

  const currency = ctx.dbGroup.defaultCurrency;
  const balances = await computeGroupBalances(ctx.dbGroup.id, currency);
  if (balances.length === 0) {
    await ctx.reply("這個群組目前沒有結餘，可能還沒記任何支出。");
    return;
  }

  const profileRows = await db
    .select({
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      username: users.username,
    })
    .from(users)
    .where(inArray(users.id, balances.map((b) => b.userId)));
  const profiles = new Map(profileRows.map((p) => [p.id, p]));
  const nameOf = (uid: number) => {
    const p = profiles.get(uid);
    return p ? labelUser(p) : `user#${uid}`;
  };

  // Positive (owed money) first, then negative (owes money).
  const sorted = [...balances].sort((a, b) => b.amount - a.amount);
  const lines = sorted.map((b) => {
    const dot = b.amount >= 0 ? "🟢" : "🔴";
    const sign = b.amount >= 0 ? "+" : "−";
    return `${dot} ${escapeHtml(nameOf(b.userId))}　<b>${sign}${fmtGrouped(Math.abs(b.amount))}</b>`;
  });

  const text =
    `💰 <b>${escapeHtml(ctx.dbGroup.title)}</b>　餘額 · ${currency}\n\n` + lines.join("\n");
  await ctx.reply(text, { parse_mode: "HTML" });
});
