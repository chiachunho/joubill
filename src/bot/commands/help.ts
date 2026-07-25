import { Composer } from "grammy";

import type { BotContext } from "../context";

/**
 * Deliberately short. `/add 金額 說明` is the only syntax worth memorising —
 * everything else (who splits, per-person shares, the currency) lives on the
 * ⚙️ 調整 buttons attached to each expense, where it's discoverable.
 */
const HELP_TEXT = [
  "*記一筆*",
  "`/add 500 晚餐`",
  "",
  "金額怎麼寫都行：`1,200` · `300元` · `3k` · `150+200`",
  "別的幣別：`/add 3000 JPY 拉麵`",
  "只給某些人分：`/add 500 晚餐 @alice @bob`",
  "",
  "記完點訊息下方的 *⚙️ 調整*：",
  "👥 誰分 · ⚖️ 份數 · 💱 幣別 · ✏️ 金額",
  "",
  "*其他指令*",
  "`/list` — 最近支出",
  "`/balance` — 各人餘額",
  "`/settle` — 還款建議",
  "`/app` — 開啟 Mini App",
  "",
  "講過話的人會自動加入群組成員。",
].join("\n");

export const helpCommand = new Composer<BotContext>();

helpCommand.command("help", async (ctx) => {
  await ctx.reply(HELP_TEXT, { parse_mode: "Markdown" });
});
