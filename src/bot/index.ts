import { Bot } from "grammy";

import { serverEnv } from "@/lib/env";

import { addCommand } from "./commands/add";
import { balanceCommand } from "./commands/balance";
import { helpCommand } from "./commands/help";
import { listCommand } from "./commands/list";
import { settleCommand } from "./commands/settle";
import { startCommand } from "./commands/start";
import type { BotContext } from "./context";
import { registerUser } from "./middleware/registerUser";
import { trackMembership } from "./middleware/trackMembership";

let _bot: Bot<BotContext> | undefined;

/**
 * Lazy singleton — avoid requiring env at build / static-analysis time.
 * Instantiated on the first webhook hit, reused after.
 */
export function getBot(): Bot<BotContext> {
  if (_bot) return _bot;

  const bot = new Bot<BotContext>(serverEnv().TELEGRAM_BOT_TOKEN);

  bot.use(registerUser);
  bot.use(trackMembership);
  bot.use(startCommand);
  bot.use(helpCommand);
  bot.use(addCommand);
  bot.use(listCommand);
  bot.use(balanceCommand);
  bot.use(settleCommand);

  bot.catch((err) => {
    console.error("[bot] unhandled error:", err);
  });

  _bot = bot;
  return bot;
}
