import { getBot } from "@/bot";
import { botUsername } from "@/lib/bot-username";
import { telegramChatId, type GroupChat } from "@/lib/chat";
import { expenseLink } from "@/lib/deep-link";
import { appUrl } from "@/lib/help-url";
import { expenseEditPath } from "@/lib/record-path";

/**
 * Where a person adds the original photos to an expense themselves (issue #163). A chat client
 * such as Claude.ai can't hand an attachment to a tool, and a model can't write megabytes of
 * base64, so the tools give the person a link instead of shrinking the photo to fit.
 *
 * Deliberately the ordinary edit form, not a one-time upload link: this link carries no
 * credential, so it is harmless in a chat transcript; the person signs in as usual and
 * membership is checked as on any other page.
 */
export type ReceiptLinks = {
  /** The Web App's edit form, opened at the receipt photos. Every group has one. */
  uploadUrl: string;
  /** The same form in the Mini App, for a group bound to a Telegram chat. */
  telegramUrl?: string;
};

/**
 * Never throws: it runs after the record or its photos are written, where an error would tell
 * the agent the write failed (and, for add_expense, free the idempotency key for a second one).
 * Without the bot's name the result carries only `uploadUrl`.
 */
export async function receiptLinks(
  group: GroupChat & { id: number },
  expenseId: number,
): Promise<ReceiptLinks> {
  const uploadUrl = appUrl(expenseEditPath("/app", group.id, expenseId, { focus: "receipts" }));
  const chatId = telegramChatId(group);
  if (chatId === null) return { uploadUrl };
  let username: string | null = null;
  try {
    username = await botUsername(getBot().api);
  } catch (err) {
    console.error("[mcp] receiptLinks: no bot username", err);
  }
  return username
    ? { uploadUrl, telegramUrl: expenseLink(username, chatId, expenseId) }
    : { uploadUrl };
}
