import { Composer, InlineKeyboard } from "grammy";

import { serverEnv } from "@/lib/env";

import type { BotContext } from "../context";

export const appCommand = new Composer<BotContext>();

appCommand.command("app", async (ctx) => {
  if (!ctx.dbGroup) {
    await ctx.reply("這個指令只能在群組裡用。");
    return;
  }

  const { TELEGRAM_MINI_APP_NAME } = serverEnv();
  const botUsername = ctx.me.username;
  const chatId = ctx.chat!.id;
  const url = `https://t.me/${botUsername}/${TELEGRAM_MINI_APP_NAME}?startapp=group_${chatId}`;

  await ctx.reply("開啟揪帳 Mini App 👇", {
    reply_markup: new InlineKeyboard().webApp("開啟揪帳", url),
  });
});
