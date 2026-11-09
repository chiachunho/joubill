import { Composer } from "grammy";

import { listView } from "../groupViews";
import { pickGroup } from "../groupPicker";
import type { BotContext } from "../context";

export const listCommand = new Composer<BotContext>();

listCommand.command("list", async (ctx) => {
  const inPrivate = ctx.chat.type === "private";
  const group =
    ctx.dbGroup ?? (inPrivate ? await pickGroup(ctx, "list", "要看哪個群組的紀錄？") : null);
  if (!group) return;

  const view = await listView(group, { botUsername: ctx.me.username, inPrivate });
  await ctx.reply(view.text, { parse_mode: "HTML", reply_markup: view.reply_markup });
});
