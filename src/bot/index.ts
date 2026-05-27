import { Bot } from "grammy";

import { serverEnv } from "@/lib/env";

import { helpCommand } from "./commands/help";
import { startCommand } from "./commands/start";
import type { BotContext } from "./context";
import { registerUser } from "./middleware/registerUser";

let _bot: Bot<BotContext> | undefined;

/**
 * Lazy 單例：避免在 build / static analyze 階段就 require env。
 * 第一次 webhook 進來時才實例化，之後重用。
 */
export function getBot(): Bot<BotContext> {
  if (_bot) return _bot;

  const bot = new Bot<BotContext>(serverEnv().TELEGRAM_BOT_TOKEN);

  bot.use(registerUser);
  bot.use(startCommand);
  bot.use(helpCommand);

  bot.catch((err) => {
    console.error("[bot] unhandled error:", err);
  });

  _bot = bot;
  return bot;
}
