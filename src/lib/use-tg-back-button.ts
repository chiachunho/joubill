"use client";

import { useEffect } from "react";

/**
 * Wire the Telegram Mini App back button to a handler while the component
 * is mounted. Loads @twa-dev/sdk dynamically so SSR doesn't choke on
 * `window.Telegram`.
 */
export function useTelegramBackButton(onBack: () => void) {
  useEffect(() => {
    let cleanup: (() => void) | undefined;
    let cancelled = false;

    (async () => {
      const { default: WebApp } = await import("@twa-dev/sdk");
      if (cancelled) return;
      WebApp.BackButton.onClick(onBack);
      WebApp.BackButton.show();
      cleanup = () => {
        WebApp.BackButton.offClick(onBack);
        WebApp.BackButton.hide();
      };
    })();

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [onBack]);
}
