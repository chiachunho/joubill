/**
 * Invite codes: Crockford base32, 10 characters (~50 bits), shown as `K7M2Q-X9PAB`.
 * The alphabet has no I, L, O or U, so a code read aloud can't be misheard.
 * There is no rate limit in this app, so the length is the only defence against
 * guessing. Don't shorten it.
 *
 * Both ends of the contract live here: `inviteLink` builds the URL that
 * `parseInviteCode` / `normalizeInviteCode` read back.
 */
export const INVITE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const INVITE_CODE_LENGTH = 10;

/** A fresh random code, unformatted (10 characters of INVITE_ALPHABET). */
export function generateInviteCode(): string {
  // Web Crypto rather than node:crypto: this module is also bundled for the browser.
  const bytes = crypto.getRandomValues(new Uint8Array(INVITE_CODE_LENGTH));
  let out = "";
  for (let i = 0; i < INVITE_CODE_LENGTH; i++) out += INVITE_ALPHABET[bytes[i] & 31];
  return out;
}

/** `K7M2QX9PAB` → `K7M2Q-X9PAB`. */
export function formatInviteCode(code: string): string {
  const half = INVITE_CODE_LENGTH / 2;
  return `${code.slice(0, half)}-${code.slice(half)}`;
}

/**
 * Canonical form of whatever a person typed or pasted, or null if it can't be a code.
 * Forgiving the way Crockford intends: case, dashes and spaces are ignored and
 * the lookalikes I/L→1 and O→0 are folded.
 */
export function normalizeInviteCode(input: string): string | null {
  const s = input.toUpperCase().replace(/[\s-]/g, "").replace(/[IL]/g, "1").replace(/O/g, "0");
  if (s.length !== INVITE_CODE_LENGTH) return null;
  for (const ch of s) if (!INVITE_ALPHABET.includes(ch)) return null;
  return s;
}

/**
 * The shareable URL for a code; `origin` has no trailing slash. Links mostly travel through
 * LINE, whose built-in browser blocks Google login; `openExternalBrowser=1` makes LINE open
 * the link in the phone's browser instead. Other apps ignore the parameter.
 */
export function inviteLink(origin: string, code: string): string {
  return `${origin}/join/${code}?openExternalBrowser=1`;
}

/** `decodeURIComponent` that answers null instead of throwing on a malformed `%` sequence. */
export function decodeInviteParam(s: string): string | null {
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
}

/** Reads the code back out of a `/join/<code>` link or a bare code. */
export function parseInviteCode(input: string): string | null {
  const m = input.trim().match(/\/join\/([^/?#\s]+)/);
  if (!m) return normalizeInviteCode(input);
  const decoded = decodeInviteParam(m[1]);
  return decoded === null ? null : normalizeInviteCode(decoded);
}

/**
 * The one answer for every invite code that can't be used — never issued, malformed, revoked
 * or expired. Callers must not tell these apart: a different reply per cause would let someone
 * probe which codes exist. Lives here, not in invites.ts, so the join page can show the same text.
 */
export const INVITE_NOT_FOUND = { status: 404, error: "邀請碼無效或已失效" } as const;
