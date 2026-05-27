import crypto from "node:crypto";
import { z } from "zod";

/**
 * Telegram Mini App initData verification.
 *
 * Algorithm (per https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app):
 *   1. Parse the raw initData string as a query string.
 *   2. Extract `hash` and remove it from the params.
 *   3. Sort remaining `key=value` lines alphabetically by key and join with "\n".
 *      This is the data-check-string.
 *   4. secret_key = HMAC_SHA256("WebAppData", bot_token).
 *   5. expected_hash = HMAC_SHA256(secret_key, data-check-string).
 *   6. Compare expected_hash to the hash from step 2 (constant-time).
 */

const userSchema = z.object({
  id: z.number().int().positive(),
  is_bot: z.boolean().optional(),
  first_name: z.string(),
  last_name: z.string().optional(),
  username: z.string().optional(),
  language_code: z.string().optional(),
  is_premium: z.boolean().optional(),
  allows_write_to_pm: z.boolean().optional(),
  photo_url: z.string().optional(),
});

export type InitDataUser = z.infer<typeof userSchema>;

export type VerifiedInitData = {
  user: InitDataUser;
  authDate: number;
  startParam: string | null;
  queryId: string | null;
  chatInstance: string | null;
};

const MAX_AGE_SECONDS = 24 * 60 * 60;

export function verifyInitData(initData: string, botToken: string): VerifiedInitData {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) throw new Error("initData missing hash");
  params.delete("hash");

  // Removed by Telegram clients but historically present; ignore if so.
  params.delete("signature");

  const dataCheckString = Array.from(params.entries())
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join("\n");

  const secretKey = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const expectedHash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest();
  const providedHash = Buffer.from(hash, "hex");

  if (expectedHash.length !== providedHash.length) {
    throw new Error("initData hash mismatch");
  }
  if (!crypto.timingSafeEqual(expectedHash, providedHash)) {
    throw new Error("initData hash mismatch");
  }

  const authDate = parseInt(params.get("auth_date") ?? "0", 10);
  if (!authDate) throw new Error("initData missing auth_date");
  const ageSeconds = Math.floor(Date.now() / 1000) - authDate;
  if (ageSeconds > MAX_AGE_SECONDS) {
    throw new Error(`initData too old (${ageSeconds}s)`);
  }

  const userJson = params.get("user");
  if (!userJson) throw new Error("initData missing user");
  const user = userSchema.parse(JSON.parse(userJson));

  return {
    user,
    authDate,
    startParam: params.get("start_param"),
    queryId: params.get("query_id"),
    chatInstance: params.get("chat_instance"),
  };
}
