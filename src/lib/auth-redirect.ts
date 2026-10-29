/**
 * The Web App's rule for a session that is missing or expired, in one place. Both the
 * global SWR `onError` (`src/app/app/SWRProvider.tsx`) and the per-page
 * `useLoginRedirect` apply it, so they cannot disagree about what a 401 is or where it
 * leads.
 */

/** Where the Web App sends a viewer with no valid session. */
export const WEB_LOGIN_PATH = "/login";

/**
 * Whether a request failed with 401. The fetchers throw `${status} ${path}: ${body}`, so
 * the status is the message's prefix. A substring match would also catch an id in the path,
 * such as "403 /api/groups/401/stats".
 */
export function isUnauthorizedError(error: unknown): boolean {
  if (typeof error === "string") return error.startsWith("401");
  const message = (error as { message?: unknown } | null | undefined)?.message;
  return typeof message === "string" && message.startsWith("401");
}

/** The login URL, carrying the page to come back to once the viewer has signed in. */
export function loginUrl(loginPath: string, pathname: string, search: string): string {
  return `${loginPath}?next=${encodeURIComponent(pathname + search)}`;
}
