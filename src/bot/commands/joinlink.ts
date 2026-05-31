import { Composer } from "grammy";

import type { BotContext } from "../context";

export const joinLinkCommand = new Composer<BotContext>();

joinLinkCommand.command("joinlink", async (ctx) => {
  if (!ctx.dbGroup) {
    await ctx.reply("這個指令只能在群組裡用。");
    return;
  }

  const botUsername = ctx.me.username;
  const link = `https://t.me/${botUsername}?start=join_${ctx.chat!.id}`;

  await ctx.reply(
    `把這個連結分享給群組成員，點一下即可加入揪帳：\n\n${link}\n\n點連結後在私訊 Bot 按「開始」就完成囉。`,
    { link_preview_options: { is_disabled: true } },
  );
});
