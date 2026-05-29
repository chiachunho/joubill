import { decodeJwt } from "jose";
import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";

import { splitbillAdapter } from "@/lib/auth/nextAuthAdapter";
import { SESSION_COOKIE } from "@/lib/auth";

interface TelegramOIDCProfile {
  sub: string;
  name?: string;
  preferred_username?: string;
  picture?: string;
  phone_number?: string;
}

/**
 * Telegram OAuth2 + PKCE provider.
 * Discovery: https://oauth.telegram.org/.well-known/openid-configuration
 * No UserInfo endpoint — all claims come from the ID token directly.
 * Credentials: BotFather → Bot Settings → Web Login → Client ID / Secret
 *
 * Must use type:"oauth" (not "oidc") because Auth.js's OIDC branch requires
 * a userinfo_endpoint in the discovery document; Telegram's has none.
 * The oauth branch calls userinfo.request() instead, which lets us decode
 * claims from the id_token locally.
 *
 * state check is dropped because Telegram rejects state params longer than
 * ~128 chars; Auth.js generates JWE-encrypted state of 400+ chars. PKCE
 * alone provides equivalent CSRF protection (RFC 7636).
 */
const TelegramOIDC = {
  id: "telegram",
  name: "Telegram",
  type: "oauth" as const,
  authorization: {
    url: "https://oauth.telegram.org/auth",
    params: { scope: "openid profile" },
  },
  token: "https://oauth.telegram.org/token",
  clientId: process.env.AUTH_TELEGRAM_CLIENT_ID,
  clientSecret: process.env.AUTH_TELEGRAM_CLIENT_SECRET,
  checks: ["pkce"] as ("pkce" | "state")[],
  userinfo: {
    async request({ tokens }: { tokens: { id_token?: string } }) {
      return decodeJwt(tokens.id_token!);
    },
  },
  profile(profile: TelegramOIDCProfile) {
    return {
      id: profile.sub,
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
    GitHub({ allowDangerousEmailAccountLinking: true }),
    Google({ allowDangerousEmailAccountLinking: true }),
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
