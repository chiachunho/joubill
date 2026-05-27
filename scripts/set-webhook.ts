/**
 * Usage:
 *   pnpm bot:set-webhook https://<public-host>
 *
 * 會打 Telegram setWebhook，URL 自動補上 /api/telegram。
 */
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;
const base = process.argv[2];

if (!TOKEN || !SECRET) {
  console.error("Missing TELEGRAM_BOT_TOKEN or TELEGRAM_WEBHOOK_SECRET in env.");
  process.exit(1);
}

if (!base) {
  console.error("Usage: pnpm bot:set-webhook https://<public-host>");
  process.exit(1);
}

const webhookUrl = new URL("/api/telegram", base).toString();

const res = await fetch(`https://api.telegram.org/bot${TOKEN}/setWebhook`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    url: webhookUrl,
    secret_token: SECRET,
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: true,
  }),
});

const json = (await res.json()) as { ok: boolean; description?: string };

if (!json.ok) {
  console.error("setWebhook failed:", json);
  process.exit(1);
}

console.log("webhook set:", webhookUrl);

const info = await fetch(`https://api.telegram.org/bot${TOKEN}/getWebhookInfo`).then((r) =>
  r.json(),
);
console.log("getWebhookInfo:", info);
