"use client";

import { useEffect } from "react";

import { useTelegramTheme } from "@/lib/use-tg-theme";

/**
 * Client-only wrapper that initialises the Telegram WebApp on mount and
 * keeps shadcn CSS vars in sync with the active TG theme.
 * Should appear once at the layout level.
 */
export function TelegramApp({ children }: { children: React.ReactNode }) {
  useTelegramTheme();

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
