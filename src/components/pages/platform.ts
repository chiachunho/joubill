import type { ComponentType, ReactNode } from "react";

/**
 * Everything that differs between the Mini App and the Web App page copies. A page
 * body under `src/components/pages` takes one of these and nothing else platform
 * specific, so the two routes cannot drift apart in the body. Only the thin
 * `page.tsx` wrappers under `src/app/{mini,app}` pass one in.
 *
 * This file is the type alone. Each app's implementation lives in its own module
 * (`platform.mini.tsx`, `platform.web.tsx`), so a route's bundle carries only its
 * own platform's code.
 */
export type Platform = {
  /** Prefix for in-app links: "/mini" or "/app". */
  basePath: "/mini" | "/app";
  /** Authenticated request: the `tma` initData header in the Mini App, the session cookie in the Web App. */
  request: <T>(path: string, init?: RequestInit) => Promise<T>;
  /** The same request, returning the raw Response so the caller can check `res.ok` itself. */
  rawRequest: (path: string, init?: RequestInit) => Promise<Response>;
  /** The viewer's own Telegram photo, used when the bot has none. A hook, so it may hold state. */
  useSelfPhoto: () => string | null;
  /** The top-left control of the group header. */
  HeaderLeading: ComponentType;
  /**
   * Sends the back action to `href` while the page is mounted. A hook: call it
   * unconditionally at the top of the body, before any early return.
   */
  useBack: (href: string) => void;
  /** The visible back link on this platform, if it has one. */
  BackLink: ComponentType<{ href: string }>;
  /** The header above the group list, including the link to personal settings. */
  HomeHeader: ComponentType;
  /** Where an unauthenticated viewer is sent, or null to show the error instead. */
  loginPath: string | null;
  /** The "使用說明" row. The Mini App opens it in Telegram's browser; the Web App navigates. */
  HelpAction: ComponentType<{ className: string; children: ReactNode }>;
  /**
   * Whether the browser can save the CSV itself. The Web App can; Telegram's webview
   * cannot be handed an authenticated download, so the Mini App only offers sending
   * the file to the group chat.
   */
  canDownloadExport: boolean;
  /** Extra content at the foot of the personal settings page. The Web App has the sign-out button. */
  AccountSection: ComponentType;
};
