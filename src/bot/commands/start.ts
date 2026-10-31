import { Composer, InlineKeyboard } from "grammy";

import { BTN } from "@/lib/buttons";
import { groupLink } from "@/lib/deep-link";
import { clientEnv } from "@/lib/env";
import { HELP_URL } from "@/lib/help-url";
import { displayName } from "@/lib/profile";

import type { BotContext } from "../context";

export const startCommand = new Composer<BotContext>();

/** Build and send the group welcome message (used by /start and bot-join events). */
export async function sendGroupWelcome(
  ctx: BotContext & { chat: { id: number }; me: { username: string } },
) {
  // Help sits on its own row: the first button is the one that seats people, so
  // a secondary link beside it would compete with the action that matters.
  const keyboard = new InlineKeyboard()
    .url(BTN.openAppArrow, groupLink(ctx.me.username, ctx.chat.id))
    .row()
    .url(BTN.help, HELP_URL);
  // Tapping the button is what actually seats someone (opening the Mini App
  // through a group link auto-joins), so the message has to say so — otherwise
  // the group's members never get into group_members and every split is short.
  await ctx.reply(
    `嗨！我是揪帳機器人 👋\n每個人點一下下面的「${BTN.openApp}」就會加入分帳 👇\n/add 記第一筆，/help 看指令。\n就這樣，記帳分帳就是這麼簡單🫲🫱`,
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
  const name = ctx.dbUser ? displayName(ctx.dbUser) : (ctx.from?.first_name ?? "");
  const greeting = `嗨 ${name}！把我加進群組就能開始分帳。\n就這樣，就是這麼簡單🫲🫱`;
  const keyboard = new InlineKeyboard()
    .webApp(BTN.openApp, clientEnv.NEXT_PUBLIC_MINI_APP_URL)
    .row()
    .url(BTN.help, HELP_URL);
  await ctx.reply(greeting, { reply_markup: keyboard });
});
