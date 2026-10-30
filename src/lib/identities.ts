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
 * Providers a signed-in person can attach from the settings page. Telegram is excluded:
 * its identity must agree with `users.telegram_id`, which the bot and the Mini App key on,
 * and the web flow would link the identity without setting that column.
 */
export const LINKABLE_PROVIDERS: readonly LoginProvider[] = ["line", "google", "github"];

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

/** Reasons `/login?error=` can carry, as text a person can act on. */
export function loginErrorMessage(code: string | undefined): string | null {
  if (!code) return null;
  if (code === "OAuthAccountNotLinked") {
    return "這個登入方式已經屬於另一個帳號，不會自動合併。請改用原本的登入方式登入。";
  }
  return "登入失敗，請再試一次。";
}
