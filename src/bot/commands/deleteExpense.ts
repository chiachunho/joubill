import { Composer } from "grammy";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { expenses } from "@/db/schema";

import type { BotContext } from "../context";

export const deleteExpenseCallback = new Composer<BotContext>();

deleteExpenseCallback.callbackQuery(/^del_exp:(\d+)$/, async (ctx) => {
  const expenseId = Number(ctx.match[1]);
  const user = ctx.dbUser;

  if (!user) {
    await ctx.answerCallbackQuery({ text: "無法識別使用者", show_alert: true });
    return;
  }

  const [expense] = await db.select().from(expenses).where(eq(expenses.id, expenseId));

  if (!expense) {
    await ctx.answerCallbackQuery({ text: "找不到這筆支出（可能已刪除）", show_alert: true });
    return;
  }

  if (expense.createdBy !== user.id) {
    await ctx.answerCallbackQuery({ text: "只有建立者可以刪除這筆支出", show_alert: true });
    return;
  }

  // expenseSplits are cascade-deleted by the FK constraint
  await db.delete(expenses).where(eq(expenses.id, expenseId));

  await ctx.answerCallbackQuery({ text: "已刪除" });
  await ctx.editMessageText("已撤銷");
});
