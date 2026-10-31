/**
 * Login methods (`auth_identities`) as the settings page presents them. Pure, so the rules
 * that decide what a person may link or unlink are tested without a database.
 */
export const LOGIN_PROVIDERS = ["telegram", "line", "google", "github"] as const;
export type LoginProvider = (typeof LOGIN_PROVIDERS)[number];

export const PROVIDER_LABEL: Record<LoginProvider, string> = {
  telegram: "Telegram",
  line: "LINE",
  google: "Google",
  github: "GitHub",
};

export function isLoginProvider(value: string): value is LoginProvider {
  return (LOGIN_PROVIDERS as readonly string[]).includes(value);
}

/**
 * Providers a signed-in person can attach from the settings page. Linking Telegram also sets
 * `users.telegram_id` (the adapter's `linkAccount`), which the bot and the Mini App key on. It
 * only works when no other account owns that Telegram id; if one does, the `signIn` callback
 * sends the person to the merge confirm page instead (`src/lib/auth/merge-ticket.ts`).
 */
export const LINKABLE_PROVIDERS: readonly LoginProvider[] = [
  "telegram",
  "line",
  "google",
  "github",
];

export type UnlinkVerdict = { ok: true } | { ok: false; reason: "last" | "telegram" };

/**
 * Whether `provider` may be removed from an account that has `linked` login methods.
 * The last one can't go (the person would be locked out), and neither can Telegram, which
 * the bot and Mini App resolve the user by.
 */
export function canUnlink(provider: LoginProvider, linked: readonly string[]): UnlinkVerdict {
  if (provider === "telegram") return { ok: false, reason: "telegram" };
  if (linked.length <= 1) return { ok: false, reason: "last" };
  return { ok: true };
}

/** What the settings page can still add: enabled, linkable and not yet linked. */
export function linkableNow(
  enabled: readonly string[],
  linked: readonly string[],
): LoginProvider[] {
  return LINKABLE_PROVIDERS.filter((p) => enabled.includes(p) && !linked.includes(p));
}

/**
 * Reasons `/login?error=` can carry, as text a person can act on. Only signed-out failures
 * reach here; a signed-in one is a failed link and goes back to the settings page
 * (`authErrorRedirect`).
 *
 * There is no `OAuthAccountNotLinked` text on purpose (issue #105): signed in, the `signIn`
 * callback sends that case to the merge page first; signed out, Telegram and LINE carry no
 * email and GitHub / Google link by email, so Auth.js never raises it.
 */
export function loginErrorMessage(code: string | undefined): string | null {
  if (!code) return null;
  return "登入失敗，請再試一次。";
}

/** Where a failed link lands: the settings page, which reads this parameter once. */
export const LINK_ERROR_PARAM = "linkError";
const LINK_ERROR_PAGE = "/app/settings";

/**
 * Where `/login?error=` should send a visitor instead of the login page, or null to stay.
 * A signed-in visitor got there from a link that did not complete (Auth.js sends every
 * sign-in error to its sign-in page), so the login buttons would only suggest switching
 * accounts.
 */
export function authErrorRedirect(code: string | undefined, signedIn: boolean): string | null {
  if (!code || !signedIn) return null;
  return `${LINK_ERROR_PAGE}?${new URLSearchParams({ [LINK_ERROR_PARAM]: code })}`;
}

/**
 * The text for a link that did not complete. `provider` is the one the person tried, if the
 * page still knows it; the error redirect itself doesn't say.
 */
export function linkErrorMessage(code: string, provider: LoginProvider | null): string {
  const name = provider ? PROVIDER_LABEL[provider] : null;
  if (code === "OAuthCallbackError") {
    return name
      ? `沒有連結 ${name}：授權沒有完成，可能是在 ${name} 的頁面取消了。`
      : "沒有連結：授權沒有完成，可能是在授權頁取消了。";
  }
  return name ? `連結 ${name} 失敗，請再試一次。` : "連結失敗，請再試一次。";
}
