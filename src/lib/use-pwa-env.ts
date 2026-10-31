"use client";

import { useEffect, useState } from "react";

import { readPwaEnv, type PwaEnv } from "@/lib/pwa";

/**
 * The current device's `PwaEnv`, or null until mounted: the server can't know, and
 * rendering a guess would flash the wrong state. Re-read when the display mode changes.
 */
export function usePwaEnv(): PwaEnv | null {
  const [env, setEnv] = useState<PwaEnv | null>(null);
  useEffect(() => {
    const read = () => setEnv(readPwaEnv());
    read();
    const query = window.matchMedia?.("(display-mode: standalone)");
    query?.addEventListener?.("change", read);
    return () => query?.removeEventListener?.("change", read);
  }, []);
  return env;
}
