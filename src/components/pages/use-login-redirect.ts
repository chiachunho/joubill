"use client";

import { useEffect } from "react";

// web-fetch throws `${status} ${path}: ${body}`, so the status is the message's prefix.
// A substring match would also catch an id such as "403 /api/groups/401".
function isUnauthorized(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return message.startsWith("401");
}

/**
 * Sends the viewer to the platform's login page when a request failed with 401, carrying
 * the current page in `next` the way the Web App's SWR `onError` does, so a login lands
 * back where the viewer was.
 *
 * Returns whether it is doing so, so the caller can hold its loading state instead of
 * flashing an error for a page the viewer is about to leave. With no `loginPath` (the
 * Mini App, which Telegram authenticates) it does nothing and returns false, and the
 * caller shows the error.
 */
export function useLoginRedirect(error: unknown, loginPath: string | null): boolean {
  const redirecting = !!error && isUnauthorized(error) && loginPath !== null;
  useEffect(() => {
    if (!redirecting || !loginPath) return;
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `${loginPath}?next=${next}`;
  }, [redirecting, loginPath]);
  return redirecting;
}
