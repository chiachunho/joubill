import { Composer, InputFile } from "grammy";

import { buildGroupExport } from "@/lib/export";

import type { BotContext } from "../context";

export const exportCommand = new Composer<BotContext>();

exportCommand.command("export", async (ctx) => {
  if (!ctx.dbGroup) {
    await ctx.reply("這個指令只能在群組裡用。");
    return;
  }

  const file = await buildGroupExport(ctx.dbGroup.id);
  if (!file) return;

  await ctx.replyWithDocument(new InputFile(Buffer.from(file.csv), file.filename), {
    caption: "📄 全部帳目（CSV，用 Excel / Google 試算表開啟）",
  });
});
