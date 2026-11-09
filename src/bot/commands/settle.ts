import { Composer } from "grammy";

import { settleView } from "../groupViews";
import { pickGroup } from "../groupPicker";
import type { BotContext } from "../context";

export const settleCommand = new Composer<BotContext>();

settleCommand.command("settle", async (ctx) => {
  const inPrivate = ctx.chat.type === "private";
  const group =
    ctx.dbGroup ?? (inPrivate ? await pickGroup(ctx, "settle", "要看哪個群組的還款建議？") : null);
  if (!group) return;

  const view = await settleView(group, { botUsername: ctx.me.username, inPrivate });
  await ctx.reply(view.text, { parse_mode: "HTML", reply_markup: view.reply_markup });
});
