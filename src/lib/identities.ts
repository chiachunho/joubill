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

/** Reasons `/login?error=` can carry, as text a person can act on. */
export function loginErrorMessage(code: string | undefined): string | null {
  if (!code) return null;
  if (code === "OAuthAccountNotLinked") {
    return "這個登入方式已經屬於另一個帳號，不會自動合併。如果兩個都是你的，請先用其中一個登入，再到個人設定連結另一個，就能把兩個帳號合併。";
  }
  return "登入失敗，請再試一次。";
}
