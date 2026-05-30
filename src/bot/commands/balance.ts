import { Composer, InputFile } from "grammy";
import { inArray } from "drizzle-orm";

import { db } from "@/db";
import { users } from "@/db/schema";
import { fetchAvatarDataUrls } from "@/lib/cards/avatars";
import { renderBalanceCard, type BalanceRow } from "@/lib/cards/balanceCard";
import { labelUser } from "@/lib/label";
import { formatMoney } from "@/lib/money";
import { computeGroupBalances } from "@/lib/settlement";

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

  const profileRows = await db
    .select({
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      username: users.username,
      telegramId: users.telegramId,
    })
    .from(users)
    .where(inArray(users.id, balances.map((b) => b.userId)));
  const profiles = new Map(profileRows.map((p) => [p.id, p]));

  const sorted = [...balances].sort((a, b) => b.amount - a.amount);
  const nameOf = (uid: number) => {
    const p = profiles.get(uid);
    return p ? labelUser(p) : `user#${uid}`;
  };

  // Try the rendered card first; fall back to text on any failure.
  try {
    const rows: BalanceRow[] = sorted.map((b) => ({
      userId: b.userId,
      name: nameOf(b.userId),
      amount: b.amount,
    }));
    const avatars = await fetchAvatarDataUrls(
      profileRows.map((p) => ({ userId: p.id, telegramId: p.telegramId })),
    );
    const dateLabel = new Date().toISOString().slice(0, 10).replace(/-/g, "/");
    const png = await renderBalanceCard({
      title: ctx.dbGroup.title,
      currency,
      rows,
      dateLabel,
      avatars,
    });
    await ctx.replyWithPhoto(new InputFile(png, "balance.png"));
    return;
  } catch (err) {
    console.error("[balance] card render failed, falling back to text:", err);
  }

  // Text fallback
  const maxNameLen = Math.max(...sorted.map((b) => nameOf(b.userId).length));
  const lines = sorted.map(
    (b) => `${nameOf(b.userId).padEnd(maxNameLen)}  ${formatMoney(b.amount, currency)}`,
  );
  await ctx.reply("餘額\n```\n" + lines.join("\n") + "\n```", { parse_mode: "Markdown" });
});
