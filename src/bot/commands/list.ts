import { Composer, InlineKeyboard } from "grammy";
import { desc, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { expensePayers, expenses, users } from "@/db/schema";
import { BTN } from "@/lib/buttons";
import { groupLink } from "@/lib/deep-link";
import { fmt } from "@/lib/money";

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
    })
    .from(expenses)
    .where(eq(expenses.groupId, ctx.dbGroup.id))
    .orderBy(desc(expenses.spentAt))
    .limit(10);

  if (rows.length === 0) {
    await ctx.reply("這個群組還沒有任何支出，試試 /add 50 飲料");
    return;
  }

  const expenseIds = rows.map((r) => r.id);
  const payerRows = await db
    .select({
      expenseId: expensePayers.expenseId,
      displayName: users.displayName,
      firstName: users.firstName,
      username: users.username,
    })
    .from(expensePayers)
    .innerJoin(users, eq(users.id, expensePayers.payerId))
    .where(inArray(expensePayers.expenseId, expenseIds));

  // A chosen name first; otherwise the @handle, which is shorter than most full names in a
  // fixed-width column, then the provider's first name.
  const short = (p: (typeof payerRows)[number]) =>
    p.displayName ?? (p.username ? "@" + p.username : p.firstName);
  const payersByExpense = new Map<number, string[]>();
  for (const p of payerRows) {
    const list = payersByExpense.get(p.expenseId) ?? [];
    list.push(short(p));
    payersByExpense.set(p.expenseId, list);
  }

  const lines = rows.map((r) => {
    const payers = payersByExpense.get(r.id) ?? [];
    const who = payers.length === 0 ? "?" : payers.join("、");
    const date = r.spentAt.toISOString().slice(5, 10).replace("-", "/");
    const amount = fmt(Number(r.amount));
    const desc = r.description ? `  ${r.description}` : "";
    return `${date}  ${who}  ${amount} ${r.currency}${desc}`;
  });

  const appUrl = groupLink(ctx.me.username, ctx.chat!.id);
  await ctx.reply(`最近 ${rows.length} 筆\n\`\`\`\n` + lines.join("\n") + "\n```", {
    parse_mode: "Markdown",
    reply_markup: new InlineKeyboard().webApp(BTN.openApp, appUrl),
  });
});
