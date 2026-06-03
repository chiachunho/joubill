import { createRemoteJWKSet, jwtVerify } from "jose";
import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";

import { splitbillAdapter } from "@/lib/auth/nextAuthAdapter";
import { SESSION_COOKIE } from "@/lib/auth";

interface TelegramOIDCProfile {
  // OIDC subject — a per-bot pairwise identifier, NOT the Telegram user id.
  sub: string;
  // The real numeric Telegram user id. This is what the Mini App stores as
  // providerUid (from initData), so both login paths must key on it to resolve
  // to the same user.
  id: number;
  name?: string;
  preferred_username?: string;
  picture?: string;
  phone_number?: string;
}

const TELEGRAM_ISSUER = "https://oauth.telegram.org";

// Telegram has no UserInfo endpoint; claims live in the id_token. We verify
// the token signature against Telegram's published JWKS. createRemoteJWKSet
// lazily fetches and caches the keys on first use.
const telegramJwks = createRemoteJWKSet(
  new URL(`${TELEGRAM_ISSUER}/.well-known/jwks.json`),
);

/**
 * Telegram OAuth2 + PKCE provider.
 * Docs: https://core.telegram.org/bots/telegram-login
 * Credentials: BotFather → Bot Settings → Web Login → Client ID / Secret
 *
 * Three Telegram-specific deviations from a vanilla Auth.js OIDC provider:
 *
 * 1. type:"oauth" (not "oidc"). The OIDC branch runs discovery and throws if
 *    the discovery doc lacks a userinfo_endpoint — Telegram's has none. The
 *    oauth branch calls userinfo.request() instead.
 * 2. `issuer` is still set so the config passes Auth.js's endpoint assertion
 *    (which otherwise demands a userinfo URL); because `token` has a URL the
 *    callback still takes the manual branch, not discovery.
 * 3. state check is dropped — Telegram rejects state params longer than
 *    ~128 chars and Auth.js's JWE state is 400+ chars. PKCE alone provides
 *    equivalent CSRF protection (RFC 7636).
 */
const TelegramOIDC = {
  id: "telegram",
  name: "Telegram",
  type: "oauth" as const,
  issuer: TELEGRAM_ISSUER,
  authorization: {
    url: `${TELEGRAM_ISSUER}/auth`,
    params: { scope: "openid profile" },
  },
  token: `${TELEGRAM_ISSUER}/token`,
  clientId: process.env.AUTH_TELEGRAM_CLIENT_ID,
  clientSecret: process.env.AUTH_TELEGRAM_CLIENT_SECRET,
  checks: ["pkce"] as ("pkce" | "state")[],
  userinfo: {
    async request({ tokens }: { tokens: { id_token?: string } }) {
      // Verify signature, issuer and audience before trusting any claim.
      const { payload } = await jwtVerify(tokens.id_token!, telegramJwks, {
        issuer: TELEGRAM_ISSUER,
        audience: process.env.AUTH_TELEGRAM_CLIENT_ID,
      });
      return payload;
    },
  },
  profile(profile: TelegramOIDCProfile) {
    return {
      // Use the numeric Telegram user id (not `sub`) so this matches the
      // providerUid the Mini App stores; Auth.js maps this to
      // account.providerAccountId → auth_identities.providerUid.
      id: String(profile.id),
      name: profile.name ?? profile.preferred_username ?? null,
      // Telegram does not provide email. Empty string avoids type errors;
      // the adapter converts it to NULL before storing.
      email: "",
      image: profile.picture ?? null,
    };
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: splitbillAdapter,
  session: { strategy: "database" },
  providers: [
    TelegramOIDC,
    // Both GitHub and Google verify email before sharing it, so auto-linking is safe.
    // Each provider is only registered when its credential env vars are present.
    ...(process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET
      ? [GitHub({ allowDangerousEmailAccountLinking: true })]
      : []),
    ...(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET
      ? [Google({ allowDangerousEmailAccountLinking: true })]
      : []),
  ],
  // Use "session" as the cookie name so our existing resolveSession() picks
  // up Auth.js-created sessions without any changes to API route auth.
  cookies: {
    sessionToken: {
      name: SESSION_COOKIE,
      options: {
        httpOnly: true,
        sameSite: "lax" as const,
        path: "/",
        secure: process.env.NODE_ENV === "production",
      },
    },
  },
  pages: {
    signIn: "/login",
  },
  callbacks: {
    redirect({ url, baseUrl }) {
      if (url.startsWith("/")) return `${baseUrl}${url}`;
      try {
        if (new URL(url).origin === baseUrl) return url;
      } catch {
        // url is not a valid absolute URL — fall through to safe default
      }
      return `${baseUrl}/app`;
    },
  },
});
