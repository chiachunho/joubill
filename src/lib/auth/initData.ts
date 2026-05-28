import crypto from "node:crypto";
import { z } from "zod";

/**
 * Telegram Mini App initData verification.
 *
 * Per Telegram's reference implementation
 * (https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app)
 * the data-check-string uses URL-DECODED values, as parsed by URLSearchParams.
 * Multiple production SDKs (@telegram-apps/sdk, aiogram) implement it this way.
 *
 *   1. Drop `hash` (the signature) and `signature` (the optional Ed25519 field).
 *   2. Sort remaining params alphabetically by key.
 *   3. Build data-check-string = "key=decoded_value" lines joined by "\n".
 *   4. secret_key = HMAC_SHA256(key="WebAppData", msg=bot_token), raw 32 bytes.
 *   5. expected_hash = HMAC_SHA256(key=secret_key, msg=data-check-string).
 *   6. Constant-time compare with the hash field.
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
  const hashHex = params.get("hash");
  if (!hashHex) throw new Error("initData missing hash");
  params.delete("hash");
  // `signature` (Bot API 9.0+, Ed25519) stays IN the data-check-string for
  // the HMAC computation — it's only excluded from the separate third-party
  // verification path. See @telegram-apps/sdk's validation.ts (validateFp):
  //   https://github.com/Telegram-Mini-Apps/tma.js/blob/master/packages/init-data-node/src/validation.ts

  const pairs = [...params.entries()].sort(([a], [b]) => a.localeCompare(b));
  const dataCheckString = pairs.map(([k, v]) => `${k}=${v}`).join("\n");

  const secretKey = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const expectedHash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest();
  const providedHash = Buffer.from(hashHex, "hex");

  if (
    expectedHash.length !== providedHash.length ||
    !crypto.timingSafeEqual(expectedHash, providedHash)
  ) {
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
