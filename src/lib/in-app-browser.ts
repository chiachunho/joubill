/**
 * Whether a User-Agent is an app's built-in browser (LINE, Telegram). Google refuses OAuth
 * there with `403 disallowed_useragent`, so the login page withholds its Google button.
 */
export function isInAppBrowser(userAgent: string | null | undefined): boolean {
  if (!userAgent) return false;
  return /\bLine\/|\bTelegram/i.test(userAgent);
}
