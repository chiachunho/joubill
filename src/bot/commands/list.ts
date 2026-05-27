import { Composer } from "grammy";
import { desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { expenses, users } from "@/db/schema";

import type { BotContext } from "../context";

export const listCommand = new Composer<BotContext>();

listCommand.command("list", async (ctx) => {
  if (!ctx.dbGroup) {
    await ctx.reply("這個指令只能在群組裡用。");
    return;
  }

  const rows = await db
    .select({
      id: expenses.id,
      amount: expenses.amount,
      currency: expenses.currency,
      description: expenses.description,
      spentAt: expenses.spentAt,
      payerFirstName: users.firstName,
      payerUsername: users.username,
    })
    .from(expenses)
    .innerJoin(users, eq(users.id, expenses.payerId))
    .where(eq(expenses.groupId, ctx.dbGroup.id))
    .orderBy(desc(expenses.spentAt))
    .limit(10);

  if (rows.length === 0) {
    await ctx.reply("這個群組還沒有任何支出，試試 /add 50 飲料");
    return;
  }

  const lines = rows.map((r) => {
    const who = r.payerUsername ? "@" + r.payerUsername : r.payerFirstName;
    const date = r.spentAt.toISOString().slice(5, 10).replace("-", "/");
    return `#${r.id} ${date}  ${who}  ${r.amount} ${r.currency}` +
      (r.description ? `  ${r.description}` : "");
  });

  await ctx.reply(`最近 ${rows.length} 筆支出\n` + lines.join("\n"));
});
