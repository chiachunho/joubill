import { Composer } from "grammy";
import { inArray } from "drizzle-orm";

import { db } from "@/db";
import { users } from "@/db/schema";
import { formatMoney } from "@/lib/money";
import { computeGroupBalances } from "@/lib/settlement";

import type { BotContext } from "../context";

export const balanceCommand = new Composer<BotContext>();

balanceCommand.command("balance", async (ctx) => {
  if (!ctx.dbGroup) {
    await ctx.reply("這個指令只能在群組裡用。");
    return;
  }

  const balances = await computeGroupBalances(ctx.dbGroup.id, ctx.dbGroup.defaultCurrency);
  if (balances.length === 0) {
    await ctx.reply("這個群組目前沒有結餘，可能還沒記任何支出。");
    return;
  }

  const profileRows = await db
    .select({ id: users.id, firstName: users.firstName, username: users.username })
    .from(users)
    .where(inArray(users.id, balances.map((b) => b.userId)));
  const profiles = new Map(profileRows.map((p) => [p.id, p]));

  const sorted = [...balances].sort((a, b) => b.amount - a.amount);
  const lines = sorted.map((b) => {
    const p = profiles.get(b.userId);
    const who = p?.username ? "@" + p.username : (p?.firstName ?? `user#${b.userId}`);
    return `${who.padEnd(16)} ${formatMoney(b.amount, ctx.dbGroup!.defaultCurrency)}`;
  });

  await ctx.reply("目前餘額\n```\n" + lines.join("\n") + "\n```", { parse_mode: "Markdown" });
});
