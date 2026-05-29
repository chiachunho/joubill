import { Composer } from "grammy";

import { createMagicToken } from "@/lib/auth/magicLink";
import { clientEnv, serverEnv } from "@/lib/env";

import type { BotContext } from "../context";

export const linkCommand = new Composer<BotContext>();

linkCommand.command("link", async (ctx) => {
  const group = ctx.dbGroup;
  if (!group) {
    await ctx.reply("這個指令只能在群組裡用。");
    return;
  }

  const token = createMagicToken(group.id, serverEnv().TELEGRAM_WEBHOOK_SECRET);
  const origin = new URL(clientEnv.NEXT_PUBLIC_MINI_APP_URL).origin;
  const link = `${origin}/g/${token}`;

  await ctx.reply(`網頁版群組連結 (7 天有效):\n${link}`);
});
