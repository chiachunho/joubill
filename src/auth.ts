import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";

import { splitbillAdapter } from "@/lib/auth/nextAuthAdapter";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: splitbillAdapter,
  session: { strategy: "database" },
  providers: [
    // Both providers verify email before sharing it, so auto-linking is safe.
    GitHub({ allowDangerousEmailAccountLinking: true }),
    Google({ allowDangerousEmailAccountLinking: true }),
  ],
  // Use "session" as the cookie name so our existing resolveSession() picks
  // up Auth.js-created sessions without any changes to API route auth.
  cookies: {
    sessionToken: {
      name: "session",
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
      if (new URL(url).origin === baseUrl) return url;
      return `${baseUrl}/app`;
    },
  },
});
