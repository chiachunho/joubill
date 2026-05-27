import { Composer, InlineKeyboard } from "grammy";

import { clientEnv } from "@/lib/env";

import type { BotContext } from "../context";

export const startCommand = new Composer<BotContext>();

startCommand.command("start", async (ctx) => {
  const isGroup = ctx.chat?.type === "group" || ctx.chat?.type === "supergroup";

  const greeting = isGroup
    ? `哈囉 ${ctx.from?.first_name ?? ""}！我會幫這個群組記帳。\n` +
      `輸入 /add 開始記支出，/help 看完整指令。`
    : `哈囉 ${ctx.from?.first_name ?? ""}！把我加進群組就能開始分帳。\n` +
      `先輸入 /help 看怎麼用。`;

  // Bot API 7.0 起 inline keyboard 的 web_app button 在 group 也能用
  const keyboard = new InlineKeyboard().webApp("開啟 Splitbill", clientEnv.NEXT_PUBLIC_MINI_APP_URL);

  await ctx.reply(greeting, { reply_markup: keyboard });
});
