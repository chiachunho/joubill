"use client";

import { useEffect } from "react";

import { isUnauthorizedError, loginUrl } from "@/lib/auth-redirect";

/**
 * Sends the viewer to the platform's login page when a request failed with 401, carrying
 * the current page in `next` so a login lands back where the viewer was. The rule itself
 * (`isUnauthorizedError`, `loginUrl`) is shared with the Web App's global SWR `onError`.
 *
 * Returns whether it is doing so, so the caller can hold its loading state instead of
 * flashing an error for a page the viewer is about to leave. With no `loginPath` (the
 * Mini App, which Telegram authenticates) it does nothing and returns false, and the
 * caller shows the error.
 */
export function useLoginRedirect(error: unknown, loginPath: string | null): boolean {
  const redirecting = !!error && isUnauthorizedError(error) && loginPath !== null;
  useEffect(() => {
    if (!redirecting || !loginPath) return;
    window.location.href = loginUrl(loginPath, window.location.pathname, window.location.search);
  }, [redirecting, loginPath]);
  return redirecting;
}
