"use client";

import { useEffect } from "react";

/**
 * Client-only wrapper that initialises the Telegram WebApp on mount.
 * Wraps the Mini App tree; should appear once at the layout level.
 */
export function TelegramApp({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { default: WebApp } = await import("@twa-dev/sdk");
      if (cancelled) return;
      WebApp.ready();
      WebApp.expand();
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return <>{children}</>;
}
