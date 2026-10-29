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

/** The shareable URL for a code; `origin` has no trailing slash. */
export function inviteLink(origin: string, code: string): string {
  return `${origin}/join/${code}`;
}

/** Reads the code back out of a `/join/<code>` link or a bare code. */
export function parseInviteCode(input: string): string | null {
  const m = input.trim().match(/\/join\/([^/?#\s]+)/);
  return normalizeInviteCode(m ? decodeURIComponent(m[1]) : input);
}
