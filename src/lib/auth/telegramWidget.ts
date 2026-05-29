import crypto from "node:crypto";

export type WidgetUser = {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
};

const MAX_AGE_SECONDS = 24 * 60 * 60;

/**
 * Verifies Telegram Login Widget callback data.
 *
 * The secret key derivation differs from Mini App initData:
 *   Widget:  secret = SHA256(bot_token)           ← plain hash
 *   initData: secret = HMAC_SHA256("WebAppData", bot_token)
 *
 * Both then compute HMAC_SHA256(secret, data_check_string).
 */
export function verifyTelegramWidget(params: URLSearchParams, botToken: string): WidgetUser {
  const hash = params.get("hash");
  if (!hash) throw new Error("missing hash");

  const pairs: string[] = [];
  for (const [key, value] of params.entries()) {
    if (key !== "hash") pairs.push(`${key}=${value}`);
  }
  pairs.sort();
  const dataCheckString = pairs.join("\n");

  const secretKey = crypto.createHash("sha256").update(botToken).digest();
  const expectedBuf = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest();
  const providedBuf = Buffer.from(hash, "hex");

  if (
    expectedBuf.length !== providedBuf.length ||
    !crypto.timingSafeEqual(expectedBuf, providedBuf)
  ) {
    throw new Error("hash mismatch");
  }

  const authDate = parseInt(params.get("auth_date") ?? "0", 10);
  if (!authDate) throw new Error("missing auth_date");
  const ageSeconds = Math.floor(Date.now() / 1000) - authDate;
  if (ageSeconds > MAX_AGE_SECONDS) throw new Error(`auth_date too old (${ageSeconds}s)`);

  const id = parseInt(params.get("id") ?? "", 10);
  if (!id) throw new Error("missing id");

  return {
    id,
    first_name: params.get("first_name") ?? "",
    last_name: params.get("last_name") ?? undefined,
    username: params.get("username") ?? undefined,
    photo_url: params.get("photo_url") ?? undefined,
    auth_date: authDate,
  };
}
