import { Composer } from "grammy";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { expenses, users } from "@/db/schema";
import { labelUser } from "@/lib/label";
import { fmtGrouped, n } from "@/lib/money";

import { escapeHtml, mention } from "../format";
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

  // Callback data is attacker-controlled, so the id alone proves nothing: without
  // this the button would delete an expense belonging to any other group. The
  // bot-side equivalent of the REST layer's assertGroupMember.
  if (!expense || !ctx.dbGroup || expense.groupId !== ctx.dbGroup.id) {
    await ctx.answerCallbackQuery({ text: "找不到這筆支出（可能已刪除）", show_alert: true });
    return;
  }

  // Anyone in the group may delete — see CLAUDE.md. What replaces the lock is
  // attribution: the message left behind says what went and who removed it, so
  // a wrong deletion is visible in the chat and retypeable, not silent.
  const [creator] = await db
    .select({ firstName: users.firstName, lastName: users.lastName, username: users.username })
    .from(users)
    .where(eq(users.id, expense.createdBy));

  // expenseSplits are cascade-deleted by the FK constraint
  await db.delete(expenses).where(eq(expenses.id, expenseId));

  const what = [
    `${fmtGrouped(n(expense.amount))} ${expense.currency}`,
    expense.description ? `（${escapeHtml(expense.description)}）` : "",
  ].join("");
  const by = creator && creator !== undefined ? labelUser(creator) : null;
  const origin = by && expense.createdBy !== user.id ? `，原本由 ${escapeHtml(by)} 記錄` : "";

  await ctx.answerCallbackQuery({ text: "已刪除" });
  await ctx.editMessageText(
    `🗑 已刪除 ${what}${origin}\n— ${mention(labelUser(user), user.telegramId)}`,
    { parse_mode: "HTML" },
  );
});
