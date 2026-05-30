/** Escape user-controlled text for Telegram HTML parse_mode. */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Render a name as a tappable Telegram inline mention (opens the user's profile
 * on tap). Works even for users without a public @username. Falls back to a
 * plain escaped name when the telegram id is unknown (e.g. non-Telegram users).
 * Used with parse_mode: "HTML".
 */
export function mention(name: string, telegramId: number | null): string {
  const safe = escapeHtml(name);
  return telegramId ? `<a href="tg://user?id=${telegramId}">${safe}</a>` : safe;
}
