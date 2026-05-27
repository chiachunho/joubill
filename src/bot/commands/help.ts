import { Composer } from "grammy";

import type { BotContext } from "../context";

const HELP_TEXT = [
  "*Splitbill 指令*",
  "",
  "`/add 300 午餐`  全群均分",
  "`/add 300 午餐 @alice @bob`  只算給被 @ 的人 (付款人不在其中)",
  "`/add 300 @alice`  我幫 alice 付的 300 (alice 整筆欠你)",
  "`/list`  最近 10 筆支出",
  "`/balance`  目前每個人的淨額",
  "`/settle`  最少筆數還款建議",
  "",
  "把我加進群組後，所有講話的人會自動註冊。",
  "點 /start 的按鈕可以打開 Mini App 看完整明細。",
  "",
  "_沒設 username 的人也能被 @（Telegram 會自動把名字轉成 mention）_",
].join("\n");

export const helpCommand = new Composer<BotContext>();

helpCommand.command("help", async (ctx) => {
  await ctx.reply(HELP_TEXT, { parse_mode: "Markdown" });
});
