"use client";

import { createContext, useContext } from "react";

import { ServiceWorkerRegistrar } from "@/components/pwa/ServiceWorkerRegistrar";

export type AuthMode = "tma" | "web";

const AuthModeContext = createContext<AuthMode>("tma");

/**
 * Also where the Web App registers its service worker (push only, issue #67). Every Web App
 * layout (`/app`, `/join/<code>`) already mounts this with `mode="web"` and the Mini App with
 * `mode="tma"`, so keying it here keeps the per-app layouts unchanged instead of editing one
 * of a page pair and not the other (`pnpm check:page-pairs`). Telegram's webview has no push.
 */
export function AuthProvider({ children, mode }: { children: React.ReactNode; mode: AuthMode }) {
  return (
    <AuthModeContext.Provider value={mode}>
      {mode === "web" && <ServiceWorkerRegistrar />}
      {children}
    </AuthModeContext.Provider>
  );
}

/** Returns "tma" inside /mini/** and "web" inside /app/**. */
export function useAuthMode(): AuthMode {
  return useContext(AuthModeContext);
}
