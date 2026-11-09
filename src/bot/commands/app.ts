import { Composer, InlineKeyboard } from "grammy";

import { button } from "@/lib/buttons";
import { clientEnv } from "@/lib/env";

import { openAppKeyboard } from "../groupViews";
import type { BotContext } from "../context";

export const appCommand = new Composer<BotContext>();

appCommand.command("app", async (ctx) => {
  // In a group it opens that group; in a private chat, the app's group list.
  const reply_markup = ctx.dbGroup
    ? openAppKeyboard(ctx.dbGroup, { botUsername: ctx.me.username, inPrivate: false })
    : new InlineKeyboard().webApp(button("openApp"), clientEnv.NEXT_PUBLIC_MINI_APP_URL);
  await ctx.reply("點下面開啟揪帳 👇", { reply_markup });
});
