import type { Page } from "@playwright/test";

import { signInitData } from "../src/lib/auth/initData";

/**
 * The Mini App authenticates with Telegram's signed `initData`, not a cookie. Outside
 * Telegram the suite signs it itself, which needs the token of the bot the target site
 * verifies with (`TELEGRAM_BOT_TOKEN` there). Without it the Mini App cases skip.
 */
export function miniBotToken(): string | undefined {
  return process.env.E2E_TELEGRAM_BOT_TOKEN || undefined;
}

export type MiniUser = { telegramId: number; firstName: string };

export type InitDataOptions = {
  /** `startapp` payload, e.g. `group_<chatId>` (built in `src/lib/deep-link.ts`). */
  startParam?: string;
  /** Seconds since the epoch; defaults to now. */
  authDate?: number;
  /** Sign with this token instead of the real one. */
  botToken?: string;
};

export function initDataFor(user: MiniUser, opts: InitDataOptions = {}): string {
  const token = opts.botToken ?? miniBotToken();
  if (!token) throw new Error("E2E_TELEGRAM_BOT_TOKEN is not set");
  const params: Record<string, string> = {
    auth_date: String(opts.authDate ?? Math.floor(Date.now() / 1000)),
    query_id: "AAE2E",
    user: JSON.stringify({ id: user.telegramId, first_name: user.firstName }),
  };
  if (opts.startParam) params.start_param = opts.startParam;
  return signInitData(params, token);
}

export function tmaHeaders(initData: string): Record<string, string> {
  return { Authorization: `tma ${initData}` };
}

/**
 * Opens a Mini App page the way a Telegram client does: the launch parameters ride in the
 * URL fragment, where `telegram-web-app.js` reads `tgWebAppData` into `WebApp.initData`
 * (and keeps it in sessionStorage across in-app navigations).
 */
export async function openMini(
  page: Page,
  path: string,
  user: MiniUser,
  opts: InitDataOptions = {},
): Promise<void> {
  const fragment = new URLSearchParams({
    tgWebAppData: initDataFor(user, opts),
    tgWebAppVersion: "8.0",
    tgWebAppPlatform: "tdesktop",
    tgWebAppThemeParams: "{}",
  });
  await page.goto(`/mini${path}#${fragment.toString()}`);
  // Without Telegram's script there is no initData, and every request would just 401,
  // which reads like an auth bug; fail here with the real cause instead.
  await page
    .waitForFunction(
      () =>
        !!(window as unknown as { Telegram?: { WebApp?: { initData?: string } } }).Telegram?.WebApp
          ?.initData,
      undefined,
      { timeout: 15_000 },
    )
    .catch(() => {
      throw new Error("telegram-web-app.js did not load, so the Mini App has no initData");
    });
}
