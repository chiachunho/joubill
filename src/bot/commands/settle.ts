import { Composer } from "grammy";
import { inArray } from "drizzle-orm";

import { db } from "@/db";
import { users } from "@/db/schema";
import { labelUser } from "@/lib/label";
import { fmtGrouped } from "@/lib/money";
import { computeGroupBalances, minimizeTransfers } from "@/lib/settlement";

import { escapeHtml, mention } from "../format";
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

  const involvedIds = Array.from(
    new Set(transfers.flatMap((t) => [t.fromUserId, t.toUserId])),
  );
  const profileRows = await db
    .select({
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      username: users.username,
      telegramId: users.telegramId,
    })
    .from(users)
    .where(inArray(users.id, involvedIds));
  const profiles = new Map(profileRows.map((p) => [p.id, p]));
  const mentionOf = (uid: number) => {
    const p = profiles.get(uid);
    return p ? mention(labelUser(p), p.telegramId) : `user#${uid}`;
  };

  const lines = transfers.map(
    (t) => `${mentionOf(t.fromUserId)} → ${mentionOf(t.toUserId)}　<b>${fmtGrouped(t.amount)}</b>`,
  );

  const text =
    `🤝 <b>${escapeHtml(ctx.dbGroup.title)}</b>　還款建議\n\n` +
    lines.join("\n") +
    `\n\n共 <b>${transfers.length}</b> 筆 · ${currency}`;
  await ctx.reply(text, { parse_mode: "HTML" });
});
