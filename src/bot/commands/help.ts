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
  "`/join @alice @bob` — 把人加進揪帳",
  "回覆某人的訊息再打 `/join` — 最準的加人方式",
  "",
  "講過話的人自動加入，也可以從 @ 清單選取沒有 username 的人。",
  "Telegram 不給 bot 群組成員名單，所以沒講過話的人要用 /join 或點歡迎訊息的按鈕。",
].join("\n");

export const helpCommand = new Composer<BotContext>();

helpCommand.command("help", async (ctx) => {
  await ctx.reply(HELP_TEXT, { parse_mode: "Markdown" });
});
