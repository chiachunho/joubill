import { Composer, InlineKeyboard } from "grammy";

import { clientEnv, serverEnv } from "@/lib/env";

import type { BotContext } from "../context";

export const startCommand = new Composer<BotContext>();

startCommand.command("start", async (ctx) => {
  const isGroup = ctx.chat?.type === "group" || ctx.chat?.type === "supergroup";

  if (isGroup) {
    // Telegram restriction: the web_app inline-button type is private-chat only.
    // In groups we instead use a url button pointing to the BotFather-registered
    // direct-link Mini App (t.me/<bot>/<app>); Telegram clients auto-launch it as
    // a Mini App. The startapp value is delivered as start_param inside initData,
    // which C5 reads on the Mini App side.
    const botUsername = ctx.me.username;
    const appName = serverEnv().TELEGRAM_MINI_APP_NAME;
    const startParam = `group_${ctx.chat.id}`;
    const miniAppLink = `https://t.me/${botUsername}/${appName}?startapp=${startParam}`;

    const greeting =
      `嗨 ${ctx.from?.first_name ?? ""}！揪帳來幫這個群組記帳。\n` +
      `輸入 /add 記第一筆支出，/help 看完整指令，就這樣 🧾`;
    const keyboard = new InlineKeyboard().url("開啟揪帳", miniAppLink);
    await ctx.reply(greeting, { reply_markup: keyboard });
    return;
  }

  // Private chat: the web_app button can launch the Mini App directly.
  const greeting =
    `嗨 ${ctx.from?.first_name ?? ""}！把我加進群組就能開始分帳。\n` +
    `輸入 /help 看怎麼用，或直接點下面按鈕，就這樣 🧾`;
  const keyboard = new InlineKeyboard().webApp(
    "開啟揪帳",
    clientEnv.NEXT_PUBLIC_MINI_APP_URL,
  );
  await ctx.reply(greeting, { reply_markup: keyboard });
});
