"use client";

import { createContext, useContext } from "react";

export type AuthMode = "tma" | "web";

const AuthModeContext = createContext<AuthMode>("tma");

export function AuthProvider({ children, mode }: { children: React.ReactNode; mode: AuthMode }) {
  return <AuthModeContext.Provider value={mode}>{children}</AuthModeContext.Provider>;
}

/** Returns "tma" inside /mini/** and "web" inside /app/**. */
export function useAuthMode(): AuthMode {
  return useContext(AuthModeContext);
}
