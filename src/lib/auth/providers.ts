/**
 * Which optional web-login providers are configured. Lives apart from `src/auth.ts` so a
 * route handler can ask without importing NextAuth. Each provider is enabled only when both
 * halves of its credential pair are set; Telegram is always on.
 */
export const githubEnabled = !!(process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET);
export const googleEnabled = !!(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);
export const lineEnabled = !!(process.env.AUTH_LINE_ID && process.env.AUTH_LINE_SECRET);
