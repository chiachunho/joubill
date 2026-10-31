"use client";

import { useEffect } from "react";

import { listenForInstallPrompt } from "@/lib/install-prompt";

// At import, not in the effect: Chrome fires `beforeinstallprompt` once and early.
if (typeof window !== "undefined") listenForInstallPrompt();

/**
 * Registers `public/sw.js` (push only, see that file). Mounted by `AuthProvider` in web mode,
 * so by every Web App layout (`/app` and the public `/join/<code>`) and never the Mini App's:
 * Telegram's webview has no push, and the chat already tells those users what changed.
 * Opening the iPhone home-screen app at 我的群組 happens earlier, before React loads
 * (`LAUNCH_SCRIPT` in `src/lib/pwa.ts`).
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((err) => {
      console.warn("[sw] registration failed:", err);
    });
  }, []);
  return null;
}
