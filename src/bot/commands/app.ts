import { Composer, InlineKeyboard } from "grammy";

import { BTN } from "@/lib/buttons";
import { groupLink } from "@/lib/deep-link";

import type { BotContext } from "../context";

export const appCommand = new Composer<BotContext>();

appCommand.command("app", async (ctx) => {
  if (!ctx.dbGroup) {
    await ctx.reply("這個指令只能在群組裡用。");
    return;
  }

  const botUsername = ctx.me.username;
  const chatId = ctx.chat!.id;
  const url = groupLink(botUsername, chatId);

  await ctx.reply("開啟揪帳 Mini App 👇", {
    reply_markup: new InlineKeyboard().webApp(BTN.openApp, url),
  });
});
