import { Composer, InputFile } from "grammy";
import { inArray } from "drizzle-orm";

import { db } from "@/db";
import { users } from "@/db/schema";
import { fetchAvatarDataUrls } from "@/lib/cards/avatars";
import { renderSettleCard, type SettleRow } from "@/lib/cards/settleCard";
import { labelUser } from "@/lib/label";
import { fmt } from "@/lib/money";
import { computeGroupBalances, minimizeTransfers } from "@/lib/settlement";

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
  const nameOf = (uid: number) => {
    const p = profiles.get(uid);
    return p ? labelUser(p) : `user#${uid}`;
  };

  // Try the rendered card first; fall back to text on any failure.
  try {
    const rows: SettleRow[] = transfers.map((t) => ({
      fromUserId: t.fromUserId,
      fromName: nameOf(t.fromUserId),
      toUserId: t.toUserId,
      toName: nameOf(t.toUserId),
      amount: t.amount,
    }));
    const avatars = await fetchAvatarDataUrls(
      profileRows.map((p) => ({ userId: p.id, telegramId: p.telegramId })),
    );
    const png = await renderSettleCard({ title: ctx.dbGroup.title, currency, rows, avatars });
    await ctx.replyWithPhoto(new InputFile(png, "settle.png"));
    return;
  } catch (err) {
    console.error("[settle] card render failed, falling back to text:", err);
  }

  // Text fallback
  const lines = transfers.map(
    (t) => `${nameOf(t.fromUserId)} → ${nameOf(t.toUserId)}  ${fmt(t.amount)} ${currency}`,
  );
  await ctx.reply(`還款建議（${transfers.length} 筆）\n\`\`\`\n` + lines.join("\n") + "\n```", {
    parse_mode: "Markdown",
  });
});
