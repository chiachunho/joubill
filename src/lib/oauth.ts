import crypto from "node:crypto";

/**
 * The pure half of the OAuth 2.1 server for Claude.ai / ChatGPT connectors (issue #152):
 * what a redirect URI, a PKCE verifier, a scope or a client name may look like, and the
 * shape of the tokens. Nothing here touches the database, so each rule is tested on its own.
 */

export const CODE_TTL_MS = 10 * 60_000;
export const ACCESS_TTL_MS = 60 * 60_000;
export const REFRESH_TTL_MS = 90 * 86_400_000;

export const SCOPE_READ = "records:read";
export const SCOPE_WRITE = "records:write";
export const SUPPORTED_SCOPES = [SCOPE_READ, SCOPE_WRITE] as const;

export const MAX_REDIRECT_URIS = 5;
export const MAX_CLIENT_NAME = 60;

export type Access = "read" | "write";

/**
 * The most a request asks for. An absent scope means the narrowest one, and `records:write`
 * includes reading. Unknown scopes are refused rather than ignored, so a typo can't widen
 * or silently narrow a grant.
 */
export function parseScope(scope: string | null | undefined): Access | null {
  const parts = (scope ?? "").split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "read";
  if (!parts.every((p) => (SUPPORTED_SCOPES as readonly string[]).includes(p))) return null;
  return parts.includes(SCOPE_WRITE) ? "write" : "read";
}

/** The scope string a granted access is reported as. */
export function scopeOf(access: Access): string {
  return access === "write" ? `${SCOPE_READ} ${SCOPE_WRITE}` : SCOPE_READ;
}

/** What a person may grant: never more than the client asked for. */
export function capAccess(requested: Access, chosen: Access): Access {
  return requested === "read" ? "read" : chosen;
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
/** Schemes that run code or read local data instead of handing a code to an app. */
const DANGEROUS_SCHEMES = new Set([
  "javascript:",
  "data:",
  "file:",
  "vbscript:",
  "blob:",
  "about:",
  "http:", // only loopback, handled below
  "ftp:",
  "ws:",
  "wss:",
]);

/**
 * Whether `uri` may be registered as a redirect target: https, plain http only to loopback
 * (a desktop client's local listener, RFC 8252), or an app's own scheme such as `cursor://`.
 * No credentials, no fragment.
 */
export function isAcceptableRedirectUri(uri: string): boolean {
  if (uri.length > 2000) return false;
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.hash || url.username || url.password) return false;
  if (url.protocol === "https:") return url.hostname.length > 0;
  if (url.protocol === "http:") return LOOPBACK.has(url.hostname);
  if (DANGEROUS_SCHEMES.has(url.protocol)) return false;
  return /^[a-z][a-z0-9+.-]*:$/.test(url.protocol) && uri.includes("://");
}

/** What the consent page shows so a person can tell who will receive the code. */
export function redirectLabel(uri: string): string {
  try {
    const url = new URL(uri);
    return url.protocol === "https:" || url.protocol === "http:" ? url.host : `${url.protocol}//`;
  } catch {
    return "?";
  }
}

/** The client's own name, made safe to print and to quote in "透過 X 記錄". */
export function sanitizeClientName(name: unknown, fallback = "未命名的應用程式"): string {
  const cleaned =
    typeof name === "string"
      ? name
          .normalize("NFKC")
          // Controls, line/paragraph separators and bidi overrides can reorder what is shown.
          .replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu, " ")
          .replace(/\s+/g, " ")
          .trim()
      : "";
  return (cleaned || fallback).slice(0, MAX_CLIENT_NAME);
}

const VERIFIER_RE = /^[A-Za-z0-9._~-]{43,128}$/;
const CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/;

export function isValidChallenge(challenge: string): boolean {
  return CHALLENGE_RE.test(challenge);
}

/** `S256` only: `plain` would let anyone who sees the authorize URL redeem the code. */
export function verifyPkce(verifier: string, challenge: string): boolean {
  if (!VERIFIER_RE.test(verifier)) return false;
  const expected = crypto.createHash("sha256").update(verifier).digest("base64url");
  const a = Buffer.from(expected);
  const b = Buffer.from(challenge);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Made by the client, so tests (and the E2E) can build a pair the same way. */
export function pkcePair(verifier = crypto.randomBytes(32).toString("base64url")) {
  return {
    verifier,
    challenge: crypto.createHash("sha256").update(verifier).digest("base64url"),
  };
}

export const CLIENT_ID_PREFIX = "sbcli_";
export const CODE_PREFIX = "sbc_";
export const ACCESS_PREFIX = "sbo_";
export const REFRESH_PREFIX = "sbr_";
export const SECRET_PREFIX = "sbs_";

const random = (prefix: string) => prefix + crypto.randomBytes(32).toString("base64url");

export const newClientId = () => CLIENT_ID_PREFIX + crypto.randomBytes(16).toString("base64url");
export const newCode = () => random(CODE_PREFIX);
export const newAccessToken = () => random(ACCESS_PREFIX);
export const newRefreshToken = () => random(REFRESH_PREFIX);
export const newClientSecret = () => random(SECRET_PREFIX);

/** An OAuth access token in `Authorization: Bearer sbo_…`, or null. */
const ACCESS_RE = /^sbo_[A-Za-z0-9_-]{43}$/;
export function parseAccessToken(header: string | null): string | null {
  const token = header?.match(/^Bearer\s+(\S+)$/i)?.[1];
  return token && ACCESS_RE.test(token) ? token : null;
}

/**
 * Credentials at the token endpoint: HTTP Basic or `client_id` / `client_secret` in the form.
 * Basic wins when both are present.
 */
export function clientCredentials(
  authorization: string | null,
  form: URLSearchParams,
): { clientId: string | null; clientSecret: string | null } {
  const basic = authorization?.match(/^Basic\s+(\S+)$/i)?.[1];
  if (basic) {
    const decoded = Buffer.from(basic, "base64").toString("utf8");
    const i = decoded.indexOf(":");
    if (i > 0) {
      try {
        return {
          clientId: decodeURIComponent(decoded.slice(0, i)),
          clientSecret: decodeURIComponent(decoded.slice(i + 1)),
        };
      } catch {
        return { clientId: null, clientSecret: null };
      }
    }
  }
  return { clientId: form.get("client_id"), clientSecret: form.get("client_secret") };
}
