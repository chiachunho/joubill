import type { Api } from "grammy";

/** Cached across invocations in the same lambda — the username never changes. */
let cachedBotUsername: string | undefined;
/** When the last `getMe` failed; a failure is remembered briefly so it isn't retried on every request. */
let failedAt = 0;

const RETRY_AFTER_MS = 60_000;
const TIMEOUT_MS = 2_000;

export async function botUsername(api: Api): Promise<string | null> {
  if (cachedBotUsername) return cachedBotUsername;
  if (Date.now() - failedAt < RETRY_AFTER_MS) return null;
  try {
    // A slow Telegram must not hold up the request that only wants the name as a garnish.
    const me = await Promise.race([
      api.getMe(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("getMe timed out")), TIMEOUT_MS),
      ),
    ]);
    cachedBotUsername = me.username;
    return cachedBotUsername;
  } catch {
    failedAt = Date.now();
    return null;
  }
}
