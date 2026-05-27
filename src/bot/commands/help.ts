import { Composer } from "grammy";

import type { BotContext } from "../context";

const HELP_TEXT = [
  "*Splitbill 指令*",
  "",
  "`/add <金額> <說明> @user1 @user2 ...`  新增支出（均分）",
  "`/list`  列出最近 10 筆支出",
  "`/balance`  目前每個人的淨額",
  "`/settle`  最少筆數還款建議",
  "",
  "把我加進群組後，所有講話的人會自動註冊。",
  "點 /start 的按鈕可以打開 Mini App 看完整明細。",
].join("\n");

export const helpCommand = new Composer<BotContext>();

helpCommand.command("help", async (ctx) => {
  await ctx.reply(HELP_TEXT, { parse_mode: "Markdown" });
});
