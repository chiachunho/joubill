import { Composer } from "grammy";

import { fmtGrouped } from "@/lib/money";
import { computeGroupBalances, minimizeTransfers } from "@/lib/settlement";

import { escapeHtml } from "../format";
import { loadMentionMap } from "../profiles";
import type { BotContext } from "../context";

export const settleCommand = new Composer<BotContext>();

settleCommand.command("settle", async (ctx) => {
  if (!ctx.dbGroup) {
    await ctx.reply("這個指令只能在群組裡用。");
    return;
  }

  const currency = ctx.dbGroup.defaultCurrency;
  const balances = await computeGroupBalances(ctx.dbGroup.id, currency);
  const transfers = minimizeTransfers(balances);

  if (transfers.length === 0) {
    await ctx.reply("目前沒有未結算的金額 🎉");
    return;
  }

  const mentionOf = await loadMentionMap(
    Array.from(new Set(transfers.flatMap((t) => [t.fromUserId, t.toUserId]))),
  );

  const lines = transfers.map(
    (t) => `${mentionOf(t.fromUserId)} → ${mentionOf(t.toUserId)}　<b>${fmtGrouped(t.amount)}</b>`,
  );

  const text =
    `🤝 <b>${escapeHtml(ctx.dbGroup.title)}</b>　還款建議 · ${currency}\n\n` +
    lines.join("\n");
  await ctx.reply(text, { parse_mode: "HTML" });
});
