import { Composer, InlineKeyboard } from "grammy";

import { BTN } from "@/lib/buttons";
import { HELP_URL } from "@/lib/help-url";

import type { BotContext } from "../context";

/**
 * Deliberately short. `/add 金額 說明` is the only syntax worth memorising —
 * everything else (who splits, per-person shares, the currency) lives on the
 * ⚙️ 調整 buttons attached to each expense, where it's discoverable.
 *
 * The 記一筆 section mirrors `ADD_USAGE` (`src/lib/parseAdd.ts`), which a bare
 * `/add` shows; keep the two in step. They stay separate strings because this
 * one is Markdown and that one has to be plain text.
 */
const HELP_TEXT = [
  "*記一筆*",
  "`/add 500 晚餐`",
  "",
  "金額怎麼寫都行：`1,200` · `300元` · `3k` · `150+200`",
  "別的幣別：`/add 3000 JPY 拉麵`",
  "只給某些人分：`/add 500 晚餐 @alice @bob`",
  "",
  `記完點訊息下方的 *${BTN.adjust}*：`,
  `${BTN.payer} · ${BTN.who} · ${BTN.shares} · ${BTN.currency} · ${BTN.amount}`,
  "",
  "*其他指令*",
  "`/list` — 最近支出",
  "`/balance` — 各人餘額",
  "`/settle` — 還款建議",
  "`/export` — 匯出全部帳目（CSV）",
  "`/link 邀請碼` — 綁定網頁建立的群組",
  "`/timezone` — 群組時區（決定 /add 記在哪一天）",
  "`/unlink` — 解除綁定（bot 會離開）",
  "`/app` — 開啟 Mini App",
  "",
  "*把人加進揪帳*",
  "回覆對方的訊息，再打 `/join`。",
  "用過 bot 的人會自動加入。",
].join("\n");

export const helpCommand = new Composer<BotContext>();

helpCommand.command("help", async (ctx) => {
  // The message stays deliberately short; anything longer lives on the help
  // site, so the button is what makes the rest of the documentation reachable.
  await ctx.reply(HELP_TEXT, {
    parse_mode: "Markdown",
    reply_markup: new InlineKeyboard().url(BTN.helpFull, HELP_URL),
  });
});
