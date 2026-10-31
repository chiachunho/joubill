import { createRemoteJWKSet, jwtVerify } from "jose";
import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";
import Line from "next-auth/providers/line";

import { splitbillAdapter } from "@/lib/auth/nextAuthAdapter";
import { SESSION_COOKIE } from "@/lib/auth";
import { CALLBACK_URL_COOKIE } from "@/lib/auth-redirect";
import { syncIdentityProfile } from "@/lib/auth/identity-profile";
import { mergeRedirect } from "@/lib/auth/merge-ticket";
import { githubEnabled, googleEnabled, lineEnabled } from "@/lib/auth/providers";

export { githubEnabled, googleEnabled, lineEnabled };

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
const telegramJwks = createRemoteJWKSet(new URL(`${TELEGRAM_ISSUER}/.well-known/jwks.json`));

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
    // LINE deliberately has NO allowDangerousEmailAccountLinking: its email is a separate
    // permission the user may refuse and LINE does not promise it is verified, so matching on
    // it would let someone take over an account by registering its address. LINE joins an
    // existing account only through the settings page (signed in), never by email.
    // These choices are also why OAuthAccountNotLinked can't happen signed out, so /login has
    // no text for it: a provider that sends a real email without auto-linking would need one.
    ...(githubEnabled ? [GitHub({ allowDangerousEmailAccountLinking: true })] : []),
    ...(googleEnabled ? [Google({ allowDangerousEmailAccountLinking: true })] : []),
    ...(lineEnabled
      ? [
          Line({
            clientId: process.env.AUTH_LINE_ID,
            clientSecret: process.env.AUTH_LINE_SECRET,
            // Drop LINE's email: it is unverified, and the user row would keep it, letting a
            // later Google/GitHub sign-in with that address auto-link into the LINE-created
            // account (a pre-registration takeover). "" is stored as NULL by the adapter.
            profile(profile) {
              return {
                id: profile.sub,
                name: profile.name,
                email: "",
                image: profile.picture,
              };
            },
          }),
        ]
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
    // Named by us so /login can read back where a failed sign-in was headed: Auth.js's error
    // redirect drops `?next=` (src/lib/auth-redirect.ts, loginCallbackUrl).
    callbackUrl: {
      name: CALLBACK_URL_COOKIE,
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
    // AccessDenied and Configuration go to `error`, the OAuth errors to `signIn`. Both land on
    // /login, which sends a signed-in visitor (a failed link) back to settings (issue #105).
    error: "/login",
  },
  events: {
    // Fires after a sign-in, a new account and a link alike, with the account already stored, so
    // the identity row exists and `user.id` is the account it belongs to (issue #101).
    async signIn({ user, account, profile }) {
      if (!account || account.type === "credentials" || !user.id) return;
      await syncIdentityProfile(
        Number(user.id),
        account.provider,
        account.providerAccountId,
        profile as Record<string, unknown> | undefined,
      );
    },
  },
  callbacks: {
    // A login that belongs to another account, used while signed in, goes to the merge
    // confirm page (issue #99) instead of failing with OAuthAccountNotLinked.
    async signIn({ account }) {
      if (!account || account.type === "credentials") return true;
      return (await mergeRedirect(account.provider, account.providerAccountId)) ?? true;
    },
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
