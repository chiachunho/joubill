import { Composer, InlineKeyboard } from "grammy";

import { clientEnv, serverEnv } from "@/lib/env";

import type { BotContext } from "../context";

export const startCommand = new Composer<BotContext>();

/** Build and send the group welcome message (used by /start and bot-join events). */
export async function sendGroupWelcome(
  ctx: BotContext & { chat: { id: number }; me: { username: string } },
) {
  const botUsername = ctx.me.username;
  const appName = serverEnv().TELEGRAM_MINI_APP_NAME;
  // Telegram restriction: web_app button only works in private chat.
  // In groups use a url button with startapp so Telegram auto-launches the Mini App.
  const miniAppLink = `https://t.me/${botUsername}/${appName}?startapp=group_${ctx.chat.id}`;
  const keyboard = new InlineKeyboard()
    .url("加入揪帳 ✋", miniAppLink)
    .row()
    .url("開啟揪帳", miniAppLink);
  await ctx.reply(
    "嗨！我是揪帳機器人 👋\n" +
      "幫這個群組記帳分帳，/add 記第一筆，/help 看指令。\n" +
      "還沒在群組發過言的成員，點「加入揪帳」就能加入帳目。",
    { reply_markup: keyboard },
  );
}

startCommand.command("start", async (ctx) => {
  const isGroup = ctx.chat?.type === "group" || ctx.chat?.type === "supergroup";

  if (isGroup) {
    await sendGroupWelcome(ctx as Parameters<typeof sendGroupWelcome>[0]);
    return;
  }

  // Private chat: the web_app button can launch the Mini App directly.
  const name = ctx.from?.first_name ?? "";
  const greeting =
    `嗨 ${name}！把我加進群組就能開始分帳。\n` +
    `點下面開啟 App，或輸入 /help 看怎麼用。`;
  const keyboard = new InlineKeyboard().webApp(
    "開啟揪帳",
    clientEnv.NEXT_PUBLIC_MINI_APP_URL,
  );
  await ctx.reply(greeting, { reply_markup: keyboard });
});
