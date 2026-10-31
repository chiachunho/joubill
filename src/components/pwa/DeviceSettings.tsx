"use client";

import { HomeScreenSection } from "@/components/pwa/HomeScreenSection";
import { NotificationSection } from "@/components/pwa/NotificationSection";
import { usePwaEnv } from "@/lib/use-pwa-env";

/**
 * The Web App's per-device sections of 個人設定 (`Platform.DeviceSettings`). The Mini App has
 * none: Telegram's webview can neither be added to a home screen nor receive push.
 */
export function DeviceSettings() {
  const env = usePwaEnv();
  if (!env) return null;
  return (
    <>
      <NotificationSection env={env} />
      <HomeScreenSection env={env} />
    </>
  );
}
