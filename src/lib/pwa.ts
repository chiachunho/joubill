/**
 * What this device can do with the Web App as an app on the home screen, and with push
 * (issue #67). The decisions are pure functions of a `PwaEnv`, so they are unit-tested
 * without a browser; `readPwaEnv` is the one place that reads `window`.
 *
 * The interface never says "安裝 App": people who dislike downloading apps read that as an
 * app-store install. It is always "加到主畫面", which is what actually happens.
 */

import { isInAppBrowser } from "@/lib/in-app-browser";

export type PwaEnv = {
  /** Opened from the home screen (`display-mode: standalone`, or iOS's `navigator.standalone`). */
  standalone: boolean;
  /** iPhone, iPad or iPod, including an iPad that reports itself as a Mac. */
  ios: boolean;
  /** LINE's or Telegram's built-in browser: neither can add a page to the home screen. */
  inAppBrowser: boolean;
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  hasNotification: boolean;
};

/**
 * - `supported`: push can be turned on here.
 * - `needs-home-screen`: an iPhone or iPad outside the home-screen app. iOS exposes
 *   `PushManager` only to a page opened from the home screen (16.4+), so the switch is shown
 *   disabled with a pointer to 加到主畫面.
 * - `unsupported`: anything else without the APIs; the switch is replaced by an explanation.
 */
export type PushSupport = "supported" | "needs-home-screen" | "unsupported";

export function pushSupport(env: PwaEnv): PushSupport {
  if (env.hasServiceWorker && env.hasPushManager && env.hasNotification) return "supported";
  if (env.ios && !env.standalone) return "needs-home-screen";
  return "unsupported";
}

/**
 * What the 主畫面捷徑 row offers.
 * - `installed`: already opened from the home screen; the row is hidden.
 * - `prompt`: the browser handed over its install prompt (`beforeinstallprompt`, Chrome and
 *   Edge), so one tap opens the browser's own dialog.
 * - `ios-steps`: iOS gives a page no way to start it, so the row opens the step-by-step sheet.
 * - `none`: nothing to offer here (Firefox, Safari on a Mac, an in-app browser, or Chrome
 *   before it has decided the site is installable).
 */
export type HomeScreenOffer = "installed" | "prompt" | "ios-steps" | "none";

export function homeScreenOffer(env: PwaEnv, hasInstallPrompt: boolean): HomeScreenOffer {
  if (env.standalone) return "installed";
  if (env.inAppBrowser) return "none";
  if (hasInstallPrompt) return "prompt";
  if (env.ios) return "ios-steps";
  return "none";
}

export function isIOS(userAgent: string, maxTouchPoints: number): boolean {
  if (/\b(iPhone|iPad|iPod)\b/.test(userAgent)) return true;
  // iPadOS 13+ asks for the desktop site and reports itself as a Mac; only the touch screen
  // gives it away.
  return /\bMacintosh\b/.test(userAgent) && maxTouchPoints > 1;
}

/** Reads the current browser. Call it only on the client (in an effect or an event handler). */
export function readPwaEnv(): PwaEnv {
  const nav = navigator as Navigator & { standalone?: boolean };
  return {
    standalone:
      window.matchMedia?.("(display-mode: standalone)").matches === true || nav.standalone === true,
    ios: isIOS(nav.userAgent, nav.maxTouchPoints ?? 0),
    inAppBrowser: isInAppBrowser(nav.userAgent),
    hasServiceWorker: "serviceWorker" in nav,
    hasPushManager: "PushManager" in window,
    hasNotification: "Notification" in window,
  };
}
