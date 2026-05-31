import { Composer } from "grammy";

import { serverEnv } from "@/lib/env";

import type { BotContext } from "../context";

export const joinLinkCommand = new Composer<BotContext>();

joinLinkCommand.command("joinlink", async (ctx) => {
  if (!ctx.dbGroup) {
    await ctx.reply("這個指令只能在群組裡用。");
    return;
  }

  const { TELEGRAM_MINI_APP_NAME } = serverEnv();
  const link = `https://t.me/${ctx.me.username}/${TELEGRAM_MINI_APP_NAME}?startapp=group_${ctx.chat!.id}`;

  await ctx.reply(
    `把這個連結分享給群組成員，點一下即可加入揪帳：\n\n${link}\n\n點連結後開啟 App 就完成了。`,
    { link_preview_options: { is_disabled: true } },
  );
});
