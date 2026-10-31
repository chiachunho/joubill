"use client";

import { useSyncExternalStore } from "react";

/**
 * Keeps the browser's `beforeinstallprompt` event so a later tap on 加到主畫面 can open the
 * browser's own dialog. Chrome fires the event once, early, and only to listeners already
 * attached, so `listenForInstallPrompt` runs from `ServiceWorkerRegistrar`, mounted in the
 * layout, rather than from the settings page that uses it.
 */

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

let deferred: BeforeInstallPromptEvent | null = null;
let listening = false;
const subscribers = new Set<() => void>();

function emit() {
  for (const fn of subscribers) fn();
}

export function listenForInstallPrompt(): void {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("beforeinstallprompt", (e) => {
    // Without this Chrome shows its own mini-infobar; the app offers it in its own words.
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    emit();
  });
}

function subscribe(fn: () => void) {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}

export type InstallOutcome = "accepted" | "dismissed" | "unavailable";

/** Opens the browser's 加到主畫面 dialog. The event can be used once, so it is dropped after. */
export async function promptInstall(): Promise<InstallOutcome> {
  const event = deferred;
  if (!event) return "unavailable";
  deferred = null;
  emit();
  try {
    await event.prompt();
    const { outcome } = await event.userChoice;
    return outcome;
  } catch {
    // The browser refused the prompt (already shown, or no user gesture): nothing opened.
    return "unavailable";
  }
}

/** Whether a tap can open the browser's own install dialog right now. */
export function useHasInstallPrompt(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => deferred !== null,
    () => false,
  );
}
