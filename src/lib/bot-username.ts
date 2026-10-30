import type { Api } from "grammy";

/** Cached across invocations in the same lambda — the username never changes. */
let cachedBotUsername: string | undefined;

export async function botUsername(api: Api): Promise<string | null> {
  if (cachedBotUsername) return cachedBotUsername;
  try {
    const me = await api.getMe();
    cachedBotUsername = me.username;
    return cachedBotUsername;
  } catch {
    return null;
  }
}
