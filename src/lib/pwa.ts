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

/**
 * Marks a URL a notification tap opens (`recordPushUrl` in `src/lib/push-notice.ts`), so the
 * launch script below leaves it on the record it was opened for, then removes it. Both ends
 * live here.
 */
const OPENED_FROM_PUSH_PARAM = "via";
const OPENED_FROM_PUSH_VALUE = "push";

/** `path` (a site path, possibly with a query) marked as opened from a notification. */
export function openedFromPush(path: string): string {
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}${OPENED_FROM_PUSH_PARAM}=${OPENED_FROM_PUSH_VALUE}`;
}

/** Set for the life of one launch of the home-screen app; a relaunch starts without it. */
const LAUNCHED_KEY = "jiuzhang:launched";

// Shared by `isIOS` and the launch script, so the two can't disagree about what an iPhone is.
const IOS_DEVICE = /\b(iPhone|iPad|iPod)\b/;
const IPAD_AS_MAC = /\bMacintosh\b/;

/**
 * Runs inline in the document head (`src/app/layout.tsx`), before React or any request, on
 * every page of the site. Two jobs:
 *
 * 1. **Open the iPhone home-screen app at 我的群組.** iOS saves the page that was on screen
 *    as the shortcut, ignoring the manifest's `start_url`, so adding it from a group page
 *    would make every launch open that group. The first page of a launch (no `LAUNCHED_KEY`
 *    in `sessionStorage`, which a reload, navigation and the OAuth round trip all keep) on an
 *    `/app/…` page is replaced by `/app` before anything renders or asks the API, so no 401
 *    can remember the old page as the place to come back to. Only on iOS: Android honours
 *    `start_url`, and opens links to the site in the installed app, which this would wrongly
 *    send to 我的群組. `/join/<code>`, `/login` and the help site are where a link meant to send
 *    someone, and a notification tap (`openedFromPush`) is opened for one record.
 * 2. **Drop the notification marker** from the address once read, on any device, so it
 *    doesn't linger in history or a later login's `?next=`.
 *
 * A string rather than a function's source, because the bundler rewrites function bodies;
 * `pwa.test.ts` runs this exact string against stubbed browser objects.
 */
export const LAUNCH_SCRIPT = `(function () {
  try {
    var url = new URL(location.href);
    var fromPush = url.searchParams.get(${JSON.stringify(OPENED_FROM_PUSH_PARAM)}) === ${JSON.stringify(OPENED_FROM_PUSH_VALUE)};
    if (fromPush) {
      url.searchParams.delete(${JSON.stringify(OPENED_FROM_PUSH_PARAM)});
      history.replaceState(history.state, "", url.pathname + url.search + url.hash);
    }
    var nav = navigator;
    var standalone =
      (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) ||
      nav.standalone === true;
    var ios =
      ${IOS_DEVICE}.test(nav.userAgent) ||
      (${IPAD_AS_MAC}.test(nav.userAgent) && nav.maxTouchPoints > 1);
    if (!standalone || !ios) return;
    if (sessionStorage.getItem(${JSON.stringify(LAUNCHED_KEY)})) return;
    sessionStorage.setItem(${JSON.stringify(LAUNCHED_KEY)}, "1");
    if (!fromPush && url.pathname.indexOf("/app/") === 0) location.replace("/app");
  } catch (e) {}
})();`;

export function isIOS(userAgent: string, maxTouchPoints: number): boolean {
  if (IOS_DEVICE.test(userAgent)) return true;
  // iPadOS 13+ asks for the desktop site and reports itself as a Mac; only the touch screen
  // gives it away.
  return IPAD_AS_MAC.test(userAgent) && maxTouchPoints > 1;
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
