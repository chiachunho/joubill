import { Composer, InlineKeyboard } from "grammy";

import { clientEnv, serverEnv } from "@/lib/env";

import type { BotContext } from "../context";

export const startCommand = new Composer<BotContext>();

/**
 * Deep link that opens the Mini App straight into `chatId`'s group.
 *
 * Telegram restriction: a `web_app` button only works in private chat, so groups
 * get a plain url button with `startapp` — Telegram turns that into a Mini App
 * launch, and `start_param` is what the API auth path resolves to a group.
 */
export function groupMiniAppLink(botUsername: string, chatId: number): string {
  const appName = serverEnv().TELEGRAM_MINI_APP_NAME;
  return `https://t.me/${botUsername}/${appName}?startapp=group_${chatId}`;
}

/** Build and send the group welcome message (used by /start and bot-join events). */
export async function sendGroupWelcome(
  ctx: BotContext & { chat: { id: number }; me: { username: string } },
) {
  const keyboard = new InlineKeyboard().url(
    "開啟揪帳 →",
    groupMiniAppLink(ctx.me.username, ctx.chat.id),
  );
  await ctx.reply(
    "嗨！我是揪帳機器人 👋\n/add 記第一筆，/help 看指令。\n就這樣，記帳分帳就是這麼簡單🫲🫱",
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
  const greeting = `嗨 ${name}！把我加進群組就能開始分帳。\n就這樣，就是這麼簡單🫲🫱`;
  const keyboard = new InlineKeyboard().webApp("開啟揪帳", clientEnv.NEXT_PUBLIC_MINI_APP_URL);
  await ctx.reply(greeting, { reply_markup: keyboard });
});
