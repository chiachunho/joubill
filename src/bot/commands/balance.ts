import { Composer, InlineKeyboard } from "grammy";

import { BTN } from "@/lib/buttons";
import { groupLink } from "@/lib/deep-link";
import { fmtGrouped } from "@/lib/money";
import { computeGroupBalances } from "@/lib/settlement";

import { escapeHtml } from "../format";
import { loadMentionMap } from "../profiles";
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

  const mentionOf = await loadMentionMap(balances.map((b) => b.userId));

  // Positive (owed money) first, then negative (owes money).
  const sorted = [...balances].sort((a, b) => b.amount - a.amount);
  const lines = sorted.map((b) => {
    const dot = b.amount >= 0 ? "🟢" : "🔴";
    const sign = b.amount >= 0 ? "+" : "−";
    return `${dot} ${mentionOf(b.userId)}　<b>${sign}${fmtGrouped(Math.abs(b.amount))}</b>`;
  });

  const appUrl = groupLink(ctx.me.username, ctx.chat!.id);
  const text =
    `💰 <b>${escapeHtml(ctx.dbGroup.title)}</b>　餘額 · ${currency}\n\n` + lines.join("\n");
  await ctx.reply(text, {
    parse_mode: "HTML",
    reply_markup: new InlineKeyboard().webApp(BTN.openApp, appUrl),
  });
});
