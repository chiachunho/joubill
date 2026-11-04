import { Bot } from "grammy";

import { serverEnv } from "@/lib/env";

import { addCommand } from "./commands/add";
import { appCommand } from "./commands/app";
import { balanceCommand } from "./commands/balance";
import { deleteExpenseCallback } from "./commands/deleteExpense";
import { deleteGroupCallback } from "./commands/deleteGroupCallback";
import { expensePanel } from "./commands/expensePanel";
import { exportCommand } from "./commands/export";
import { helpCommand } from "./commands/help";
import { joinCommand } from "./commands/join";
import { linkCommand } from "./commands/link";
import { unlinkCommand } from "./commands/unlink";
import { listCommand } from "./commands/list";
import { receiptUploadHandler } from "./commands/receiptUpload";
import { settleCommand } from "./commands/settle";
import { startCommand } from "./commands/start";
import { chatMigration } from "./handlers/chatMigration";
import { forwardJoin } from "./handlers/forwardJoin";
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

  // Send all bot messages silently (no notification ping). Applies to every
  // send* method unless the call explicitly sets disable_notification.
  bot.api.config.use((prev, method, payload, signal) => {
    if (method.startsWith("send") && payload && !("disable_notification" in payload)) {
      (payload as Record<string, unknown>).disable_notification = true;
    }
    return prev(method, payload, signal);
  });

  // Must precede registerUser: it upserts a groups row for the incoming chat id,
  // which would create an empty duplicate under the post-upgrade supergroup id.
  bot.use(chatMigration);
  bot.use(registerUser);
  bot.use(trackMembership);
  bot.use(forwardJoin);
  bot.use(deleteExpenseCallback);
  bot.use(deleteGroupCallback);
  bot.use(expensePanel);
  bot.use(receiptUploadHandler);
  bot.use(startCommand);
  bot.use(helpCommand);
  bot.use(joinCommand);
  bot.use(linkCommand);
  bot.use(unlinkCommand);
  bot.use(addCommand);
  bot.use(appCommand);
  bot.use(listCommand);
  bot.use(balanceCommand);
  bot.use(settleCommand);
  bot.use(exportCommand);

  bot.catch((err) => {
    console.error("[bot] unhandled error:", err);
  });

  _bot = bot;
  return bot;
}
