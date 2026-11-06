import { clientEnv } from "./env";

/** Path of the public help/FAQ site (`src/app/help/**`). No auth required. */
export const HELP_PATH = "/help";

/** The privacy policy and terms of service, part of the help site (and its sidebar). */
export const PRIVACY_PATH = "/help/privacy";
export const TERMS_PATH = "/help/terms";

/** How to connect Claude, Cursor, n8n and the like through the MCP server (issue #150). */
export const MCP_HELP_PATH = "/help/mcp";

/**
 * Absolute URL of the help site.
 *
 * Derived from `NEXT_PUBLIC_MINI_APP_URL`'s origin rather than its own env var:
 * the help site is always served by this same Next.js app, so a second variable
 * would only add a way for the two to disagree. The bot needs an absolute URL
 * (an inline-keyboard `url` button can't take a path), and the Mini App needs
 * one too because `WebApp.openLink` opens an external browser.
 */
export const HELP_URL = appUrl(HELP_PATH);

/** Absolute URL of any path on this app, for links that must leave Telegram's webview. */
export function appUrl(path: string): string {
  return new URL(path, clientEnv.NEXT_PUBLIC_MINI_APP_URL).toString();
}
