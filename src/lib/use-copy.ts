"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** How long a button reads 已複製 after a successful copy. */
export const COPIED_MS = 2000;

/**
 * Copy text to the clipboard, the one way every copy button in the app does it:
 * `copied` names what was just copied (for 已複製) and clears itself after `COPIED_MS`;
 * `refused` holds the text the clipboard refused (Telegram's webview and some browsers do),
 * so the caller can show it selectable instead. `key` tells several buttons apart.
 */
export function useCopy<K extends string = "default">() {
  const [copied, setCopied] = useState<K | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = useCallback(async (text: string, key: K = "default" as K) => {
    clearTimeout(timer.current);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setRefused(null);
      timer.current = setTimeout(() => setCopied(null), COPIED_MS);
    } catch {
      setCopied(null);
      setRefused(text);
    }
  }, []);

  const reset = useCallback(() => {
    clearTimeout(timer.current);
    setCopied(null);
    setRefused(null);
  }, []);

  return { copy, copied, refused, reset };
}
