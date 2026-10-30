/**
 * A person's name and picture as everyone else sees them (issue #101). Pure, so the rules are
 * unit-tested and the client, the API routes and the bot all read the same ones.
 *
 * Two layers, on purpose: `users.first_name` / `last_name` follow the login provider and are
 * overwritten on every Telegram sync, while `users.display_name` is the person's own choice and
 * nothing but `PATCH /api/me/profile` writes it. Writing the choice into `first_name` instead
 * would be undone the next time they open the Mini App.
 */
import { LOGIN_PROVIDERS, type LoginProvider } from "@/lib/identities";

export type NameParts = {
  /** The name the person chose; wins over the provider's when set. */
  displayName: string | null;
  firstName: string | null;
  lastName?: string | null;
  username: string | null;
};

/** The provider's name: first + last, or "" when it has none. */
export function providerName(p: Pick<NameParts, "firstName" | "lastName">): string {
  return [p.firstName, p.lastName].filter(Boolean).join(" ");
}

/**
 * The name to show for a person, or "" when they have none at all. `displayName` is read with
 * `?? null` because an audit snapshot written before this column existed has no such key.
 */
export function displayName(p: NameParts): string {
  return p.displayName?.trim() || providerName(p) || (p.username ? "@" + p.username : "");
}

/** Counted in user-perceived characters, so an emoji or a CJK character is one. */
export const DISPLAY_NAME_MAX = 32;

const segmenter =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter("zh-Hant", { granularity: "grapheme" })
    : null;

export function graphemeLength(s: string): number {
  return segmenter ? [...segmenter.segment(s)].length : [...s].length;
}

// C0/C1 controls, plus the bidi marks, overrides and isolates that would let a name reorder the
// text around it in a chat message ("A 還 B" rendering as "B 還 A"), and the zero-width
// characters that would make a name invisible. ZWJ / ZWNJ stay allowed: emoji and some scripts
// need them.
const FORBIDDEN = /[\u0000-\u001f\u007f-\u009f؜​‎‏‪-‮⁠⁦-⁩﻿]/;

export type DisplayNameResult = { ok: true; value: string | null } | { ok: false; error: string };

/**
 * Validates what the person typed. Trimmed, whitespace runs collapsed; "" (or null) clears the
 * choice and goes back to the provider's name. Whitespace-only input is an error rather than a
 * clear, since it is almost always a slip rather than an intent.
 */
export function normaliseDisplayName(raw: string | null): DisplayNameResult {
  if (raw === null || raw === "") return { ok: true, value: null };
  // Checked after the trim, so a pasted trailing newline is trimmed rather than refused.
  const trimmed = raw.trim();
  if (FORBIDDEN.test(trimmed)) return { ok: false, error: "名稱不能包含控制字元" };
  const value = trimmed.replace(/\s+/g, " ");
  if (!value) return { ok: false, error: "名稱不能只有空白" };
  if (graphemeLength(value) > DISPLAY_NAME_MAX) {
    return { ok: false, error: `名稱最多 ${DISPLAY_NAME_MAX} 個字` };
  }
  return { ok: true, value };
}

export type AvatarSource = LoginProvider;
export const AVATAR_SOURCES = LOGIN_PROVIDERS;

export function isAvatarSource(value: unknown): value is AvatarSource {
  return typeof value === "string" && (AVATAR_SOURCES as readonly string[]).includes(value);
}

/** One login method's picture. Telegram's is fetched live through the bot, never stored. */
export type AvatarCandidate = { source: AvatarSource; url: string | null };

export type AvatarInput = {
  /** `users.avatar_source`; null = automatic. */
  source: string | null;
  /** The live Telegram photo (bot API), when the person has one. */
  telegramPhoto: string | null;
  /** `auth_identities.picture_url` per linked provider other than Telegram. */
  identities: { provider: string; pictureUrl: string | null }[];
  /** `users.avatar_url`: what the first login supplied. Covers anyone who hasn't signed in
   *  since `auth_identities.picture_url` existed. */
  legacyAvatarUrl: string | null;
};

/** The linked login methods that have a picture, Telegram first, then the settings page's order. */
export function avatarOptions(
  input: Omit<AvatarInput, "source" | "legacyAvatarUrl">,
): AvatarCandidate[] {
  const out: AvatarCandidate[] = [];
  if (input.telegramPhoto) out.push({ source: "telegram", url: input.telegramPhoto });
  for (const source of AVATAR_SOURCES) {
    if (source === "telegram") continue;
    const url = input.identities.find((i) => i.provider === source && i.pictureUrl)?.pictureUrl;
    if (url) out.push({ source, url });
  }
  return out;
}

/**
 * The picture to show. A chosen source wins while it is still linked and has a picture; if it
 * was unlinked (or lost its picture) this falls back to automatic rather than to nothing.
 * Automatic is Telegram's photo, then the other logins in order, then `users.avatar_url`.
 */
export function pickAvatar(input: AvatarInput): string | null {
  const options = avatarOptions(input);
  const chosen = options.find((o) => o.source === input.source);
  return chosen?.url ?? options[0]?.url ?? input.legacyAvatarUrl ?? null;
}

/**
 * Name and picture from a provider's raw OAuth profile, as Auth.js's `events.signIn` hands it
 * over (the provider's own claims, not the normalised user). Unknown fields read as null.
 */
export function identityProfile(
  provider: string,
  raw: Record<string, unknown> | undefined | null,
): { name: string | null; pictureUrl: string | null } {
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  if (!raw) return { name: null, pictureUrl: null };
  switch (provider) {
    case "github":
      return { name: str(raw.name) ?? str(raw.login), pictureUrl: str(raw.avatar_url) };
    case "telegram":
      return { name: str(raw.name) ?? str(raw.preferred_username), pictureUrl: str(raw.picture) };
    default:
      // Google and LINE both use the OIDC claims.
      return { name: str(raw.name), pictureUrl: str(raw.picture) };
  }
}
