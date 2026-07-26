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
  "*把人加進揪帳*",
  "回覆對方的訊息，再打 `/join`。",
  "用過 bot 的人會自動加入。",
  "",
  "Telegram 不給 bot 群組成員名單，也不讓 bot 從 `@帳號` 查出是誰，所以沒用過 bot 的人只能用上面這招，或點歡迎訊息的按鈕。",
].join("\n");

export const helpCommand = new Composer<BotContext>();

helpCommand.command("help", async (ctx) => {
  await ctx.reply(HELP_TEXT, { parse_mode: "Markdown" });
});
