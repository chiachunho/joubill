"use client";

import { useEffect } from "react";

/**
 * Sends the viewer to the platform's login page when a request failed with 401.
 *
 * Returns whether it is doing so, so the caller can hold its loading state instead of
 * flashing an error for a page the viewer is about to leave. With no `loginPath` (the
 * Mini App, which Telegram authenticates) it does nothing and returns false, and the
 * caller shows the error.
 */
export function useLoginRedirect(error: unknown, loginPath: string | null): boolean {
  const redirecting = !!error && String(error).includes("401") && loginPath !== null;
  useEffect(() => {
    if (redirecting && loginPath) window.location.href = loginPath;
  }, [redirecting, loginPath]);
  return redirecting;
}
