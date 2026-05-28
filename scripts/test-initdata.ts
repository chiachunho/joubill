/**
 * Verify a captured initData string against the bot token in .env.local.
 *
 * Usage:
 *   1. Open the Mini App in Telegram.
 *   2. Open browser DevTools (Mac: cmd+opt+i for macOS Telegram beta,
 *      or via remote inspect on iOS/Android).
 *   3. In console: copy(Telegram.WebApp.initData)
 *   4. Paste here:
 *      pnpm tsx scripts/test-initdata.ts '<paste>'
 *
 * The script loads .env.local, runs the same verifier the API uses, and
 * prints either the parsed user payload or a detailed failure trace.
 */
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

const initData = process.argv[2];
if (!initData) {
  console.error("Usage: pnpm tsx scripts/test-initdata.ts '<initData>'");
  process.exit(1);
}
const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error("TELEGRAM_BOT_TOKEN not set in .env.local");
  process.exit(1);
}

const { verifyInitData } = await import("../src/lib/auth/initData");

try {
  const v = verifyInitData(initData, token);
  console.log("✓ verified");
  console.log(JSON.stringify(v, null, 2));
} catch (err) {
  console.log("✗ failed:", err instanceof Error ? err.message : err);
  process.exit(1);
}
