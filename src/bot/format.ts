/**
 * Telegram HTML helpers. The implementations live in `src/lib/telegram-html.ts`
 * so that shared, unit-tested lib code (e.g. `src/lib/record-notice.ts`) can use
 * them without importing from `src/bot`. Re-exported here because every bot
 * command already imports them from this path.
 */
export { escapeHtml, mention } from "@/lib/telegram-html";
