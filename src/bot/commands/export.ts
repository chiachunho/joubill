import { Composer, InputFile } from "grammy";

import type { Group } from "@/db/schema";
import { buildGroupExport } from "@/lib/export";

import { pickGroup } from "../groupPicker";
import type { BotContext } from "../context";

export const exportCommand = new Composer<BotContext>();

/**
 * Send a group's CSV to the chat the command came from. In a private chat that is the
 * person themselves, so the file never shows up in the group.
 */
export async function sendExport(ctx: BotContext, group: Group) {
  // An unreachable FX source makes the conversion throw; say so instead of going silent.
  let file;
  try {
    file = await buildGroupExport(group.id);
  } catch (err) {
    console.error("[export] build failed:", err);
    await ctx.reply("匯出失敗，請稍後再試。");
    return;
  }
  if (!file) {
    await ctx.reply("找不到這個群組的資料。");
    return;
  }

  // The .csv name already says what it is and how to open it.
  await ctx.replyWithDocument(new InputFile(Buffer.from(file.csv), file.filename), {
    caption: "📄 全部帳目",
  });
}

exportCommand.command("export", async (ctx) => {
  const group =
    ctx.dbGroup ??
    (ctx.chat.type === "private" ? await pickGroup(ctx, "export", "要匯出哪個群組？") : null);
  if (group) await sendExport(ctx, group);
});
