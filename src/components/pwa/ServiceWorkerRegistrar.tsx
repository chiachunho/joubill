"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

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
  const router = useRouter();

  // A fresh launch of the iPhone home-screen app opens 我的群組, whatever page the shortcut
  // was saved from (see `homeScreenLaunchRedirect`). Only the first page of a launch: later
  // navigation, a reload and the OAuth round trip all keep the session storage flag. Not on
  // Android: Chrome honours the manifest's start_url already, and opens links to the site in
  // the installed app, which this would wrongly send to 我的群組.
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
    if (target) router.replace(target);
  }, [router]);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((err) => {
      console.warn("[sw] registration failed:", err);
    });
  }, []);
  return null;
}
