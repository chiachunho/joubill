import crypto from "node:crypto";

const TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

/**
 * Creates a signed magic-link token embedding the internal group ID.
 * Format: base64url(payload_json).hmac_hex
 * Secret key: TELEGRAM_WEBHOOK_SECRET (already in env, no new var needed).
 */
export function createMagicToken(groupId: number, secret: string): string {
  const exp = Math.floor(Date.now() / 1000) + TTL_SECONDS;
  const payload = Buffer.from(JSON.stringify({ g: groupId, e: exp })).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

/** Returns the groupId if the token is valid and unexpired; null otherwise. */
export function verifyMagicToken(token: string, secret: string): number | null {
  const dot = token.lastIndexOf(".");
  if (dot === -1) return null;

  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  const expectedBuf = crypto.createHmac("sha256", secret).update(payload).digest();
  const providedBuf = Buffer.from(sig, "hex");

  if (
    expectedBuf.length !== providedBuf.length ||
    !crypto.timingSafeEqual(expectedBuf, providedBuf)
  ) {
    return null;
  }

  let parsed: { g: number; e: number };
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString());
  } catch {
    return null;
  }

  if (Math.floor(Date.now() / 1000) > parsed.e) return null;

  return parsed.g;
}
