import { Composer, InlineKeyboard } from "grammy";

import { BTN, button } from "@/lib/buttons";
import { HELP_URL } from "@/lib/help-url";

import type { BotContext } from "../context";

/**
 * Deliberately short: the examples show how /add is written, and everything else
 * (who splits, per-person shares, the currency) lives on the ☰ 調整 buttons attached
 * to each expense, where it's discoverable. The rest is on the help site.
 *
 * Commands are grouped by what people come for, the common ones first; the settings
 * are only named, since the command menu describes each.
 */
const HELP_TEXT = [
  "<b>記帳</b>",
  "<code>/add 500 晚餐</code>",
  "<code>/add 3000 JPY 拉麵</code>",
  "<code>/add 500 晚餐 @alice @bob</code>",
  `記完點 ${BTN.adjust} 改${BTN.payer}、${BTN.who}、${BTN.currency}`,
  "",
  "<b>查帳</b>",
  "/balance 餘額 · /settle 怎麼還",
  "/list 最近紀錄 · /export CSV",
  "",
  "<b>加人</b>",
  "回覆對方的訊息，打 /join",
  "",
  "<b>設定</b>",
  "/timezone · /topic · /link · /unlink",
  "",
  "<i>私訊我也能用 /add、/balance、/settle、/list、/export</i>",
].join("\n");

export const helpCommand = new Composer<BotContext>();

helpCommand.command("help", async (ctx) => {
  // The message stays deliberately short; anything longer lives on the help
  // site, so the button is what makes the rest of the documentation reachable.
  await ctx.reply(HELP_TEXT, {
    parse_mode: "HTML",
    reply_markup: new InlineKeyboard().url(button("helpFull"), HELP_URL),
  });
});
