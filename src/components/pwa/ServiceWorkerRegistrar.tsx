"use client";

import { useEffect } from "react";

import { listenForInstallPrompt } from "@/lib/install-prompt";
import { homeScreenLaunchRedirect, readPwaEnv } from "@/lib/pwa";

/** Set for the life of one launch of the home-screen app; a relaunch starts without it. */
const LAUNCHED_KEY = "jiuzhang:launched";

// At import, not in the effect: Chrome fires `beforeinstallprompt` once and early.
if (typeof window !== "undefined") listenForInstallPrompt();

/**
 * Registers `public/sw.js` (push only, see that file). Mounted by `AuthProvider` in web mode,
 * so by every Web App layout (`/app` and the public `/join/<code>`) and never the Mini App's:
 * Telegram's webview has no push, and the chat already tells those users what changed.
 */
export function ServiceWorkerRegistrar() {
  // A fresh launch of the iPhone home-screen app opens 我的群組, whatever page the shortcut
  // was saved from (see `homeScreenLaunchRedirect`). Only the first page of a launch: later
  // navigation, a reload and the OAuth round trip all keep the session storage flag. Not on
  // Android: Chrome honours the manifest's start_url already, and opens links to the site in
  // the installed app, which this would wrongly send to 我的群組.
  //
  // The page underneath sends its requests in this same commit, and on the first launch (no
  // session yet: the home-screen app doesn't share Safari's cookies) their 401 sends the
  // viewer to /login?next=<this page>, which would land them back on the old page after
  // signing in. So the address is rewritten synchronously first, making any 401 handler read
  // /app as the page to come back to, and then /app is loaded.
  useEffect(() => {
    const env = readPwaEnv();
    if (!env.standalone || !env.ios) return;
    try {
      if (sessionStorage.getItem(LAUNCHED_KEY)) return;
      sessionStorage.setItem(LAUNCHED_KEY, "1");
    } catch {
      return;
    }
    const target = homeScreenLaunchRedirect(location.pathname, location.search);
    if (!target) return;
    history.replaceState(null, "", target);
    location.replace(target);
  }, []);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((err) => {
      console.warn("[sw] registration failed:", err);
    });
  }, []);
  return null;
}
