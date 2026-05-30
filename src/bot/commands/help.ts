import { Composer } from "grammy";

import type { BotContext } from "../context";

const HELP_TEXT = [
  "*指令*",
  "",
  "`/add 300 午餐` — 全群均分",
  "`/add 300 午餐 @alice @bob` — 指定分擔",
  "`/add 300 午餐` — 不等額（換行指定每人金額）",
  "`@alice 200`",
  "`@bob 100`",
  "",
  "`/list` — 最近支出",
  "`/balance` — 各人餘額",
  "`/settle` — 還款建議",
  "",
  "講過話的人自動加入，也可以從 @ 清單選取沒有 username 的人。",
].join("\n");

export const helpCommand = new Composer<BotContext>();

helpCommand.command("help", async (ctx) => {
  await ctx.reply(HELP_TEXT, { parse_mode: "Markdown" });
});
