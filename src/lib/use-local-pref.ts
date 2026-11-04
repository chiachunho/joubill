"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * A string kept in localStorage, read as an external store: the server and the first client
 * render both see `null`, then React swaps in what the browser holds, so there is no hydration
 * mismatch and no effect that copies storage into state.
 *
 * Storage can be unavailable (private mode, blocked site data), so reads and writes are
 * guarded: the value just doesn't persist. The `storage` event carries changes from other
 * tabs; `listeners` carries this tab's own writes, which the event doesn't.
 */
const listeners = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  // A write from another tab is newer than anything this tab kept in memory after storage
  // refused a write, and it shows storage works again: stop letting the old copy win.
  const onStorage = (e: StorageEvent) => {
    if (e.key === null) unpersisted.clear();
    else unpersisted.delete(e.key);
    onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Remembered for the page's life even when storage refuses the write, so a toggle still works
 * (it just doesn't survive a reload).
 */
const unpersisted = new Map<string, string>();

function readWithFallback(key: string): string | null {
  return unpersisted.get(key) ?? read(key);
}

export function useLocalPref(key: string): [string | null, (value: string) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => readWithFallback(key),
    () => null,
  );
  const set = useCallback(
    (next: string) => {
      try {
        localStorage.setItem(key, next);
        unpersisted.delete(key);
      } catch {
        unpersisted.set(key, next);
      }
      listeners.forEach((l) => l());
    },
    [key],
  );
  return [value, set];
}
