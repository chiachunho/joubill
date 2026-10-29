import { Composer, InputFile } from "grammy";

import { buildGroupExport } from "@/lib/export";

import type { BotContext } from "../context";

export const exportCommand = new Composer<BotContext>();

exportCommand.command("export", async (ctx) => {
  if (!ctx.dbGroup) {
    await ctx.reply("這個指令只能在群組裡用。");
    return;
  }

  // An unreachable FX source makes the conversion throw; say so instead of going silent.
  let file;
  try {
    file = await buildGroupExport(ctx.dbGroup.id);
  } catch (err) {
    console.error("[export] build failed:", err);
    await ctx.reply("匯出失敗，請稍後再試。");
    return;
  }
  if (!file) {
    await ctx.reply("找不到這個群組的資料。");
    return;
  }

  await ctx.replyWithDocument(new InputFile(Buffer.from(file.csv), file.filename), {
    caption: "📄 全部帳目（CSV，用 Excel / Google 試算表開啟）",
  });
});
