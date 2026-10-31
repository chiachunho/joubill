/**
 * The Web App's rule for a session that is missing or expired, in one place. Both the
 * store's 401 handler (`src/app/app/StoreProvider.tsx`) and the per-page
 * `useLoginRedirect` apply it, so they cannot disagree about what a 401 is or where it
 * leads.
 */

/** Where the Web App sends a viewer with no valid session. */
export const WEB_LOGIN_PATH = "/login";

/**
 * Whether a request failed with 401. A failed request's `message` is `${status} ${path}: ${body}`, so
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

/**
 * Auth.js's cookie for the page a sign-in should return to. Named here rather than left to
 * Auth.js's default (which changes with the `__Secure-` prefix) because `/login` reads it back:
 * `src/auth.ts` sets the name, `loginCallbackUrl` consumes the value.
 */
export const CALLBACK_URL_COOKIE = "authjs.callback-url";

/** Where the Web App lands after signing in when nothing says otherwise. */
const DEFAULT_AFTER_LOGIN = "/app";

/** A same-site path, or null for anything that could leave the site or isn't a path. */
function sitePath(value: string | undefined): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) {
    return null;
  }
  return value;
}

/**
 * The page `/login` should send a sign-in back to. `?next=` wins. After a failed sign-in
 * Auth.js redirects to `/login?error=` without it, so then the callback URL that attempt
 * stored in `CALLBACK_URL_COOKIE` (an absolute URL) is used instead: cancelling a consent
 * from an invite link must not turn the retry into a trip to `/app`. Only its path is kept,
 * so a cookie naming another origin can't send anyone off the site. Without an error the
 * cookie is ignored, since it may be left over from a sign-in long ago.
 */
export function loginCallbackUrl(
  next: string | undefined,
  error: string | undefined,
  remembered: string | undefined,
): string {
  const explicit = sitePath(next);
  if (explicit) return explicit;
  if (error && remembered) {
    try {
      const url = new URL(remembered);
      const path = sitePath(`${url.pathname}${url.search}${url.hash}`);
      if (path) return path;
    } catch {
      // Not an absolute URL: fall through to the default.
    }
  }
  return DEFAULT_AFTER_LOGIN;
}
