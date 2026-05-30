import { Composer } from "grammy";
import { inArray } from "drizzle-orm";

import { db } from "@/db";
import { users } from "@/db/schema";
import { fmt } from "@/lib/money";
import { computeGroupBalances, minimizeTransfers } from "@/lib/settlement";

import type { BotContext } from "../context";

export const settleCommand = new Composer<BotContext>();

settleCommand.command("settle", async (ctx) => {
  if (!ctx.dbGroup) {
    await ctx.reply("這個指令只能在群組裡用。");
    return;
  }

  const balances = await computeGroupBalances(ctx.dbGroup.id, ctx.dbGroup.defaultCurrency);
  const transfers = minimizeTransfers(balances);

  if (transfers.length === 0) {
    await ctx.reply("目前沒有未結算的金額 🎉");
    return;
  }

  const involvedIds = Array.from(
    new Set(transfers.flatMap((t) => [t.fromUserId, t.toUserId])),
  );
  const profileRows = await db
    .select({ id: users.id, firstName: users.firstName, username: users.username })
    .from(users)
    .where(inArray(users.id, involvedIds));
  const profiles = new Map(profileRows.map((p) => [p.id, p]));
  const label = (uid: number) => {
    const p = profiles.get(uid);
    return p?.username ? "@" + p.username : (p?.firstName ?? `user#${uid}`);
  };

  const currency = ctx.dbGroup.defaultCurrency;
  const lines = transfers.map(
    (t) => `${label(t.fromUserId)} → ${label(t.toUserId)}  ${fmt(t.amount)} ${currency}`,
  );

  await ctx.reply(`還款建議（${transfers.length} 筆）\n\`\`\`\n` + lines.join("\n") + "\n```", {
    parse_mode: "Markdown",
  });
});
