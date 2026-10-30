import { headers } from "next/headers";
import { SessionProvider } from "next-auth/react";

import { githubEnabled, googleEnabled, lineEnabled } from "@/auth";
import { Logo } from "@/components/Logo";
import { OAuthButtons } from "@/components/OAuthButtons";
import { isInAppBrowser } from "@/lib/in-app-browser";
import { loginErrorMessage } from "@/lib/identities";

type Props = { searchParams: Promise<{ next?: string; error?: string }> };

export default async function LoginPage({ searchParams }: Props) {
  const { next, error } = await searchParams;
  const errorMessage = loginErrorMessage(error);
  const inAppBrowser = isInAppBrowser((await headers()).get("user-agent"));
  const callbackUrl = next && next.startsWith("/") && !next.startsWith("//") ? next : "/app";

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-8">
        <div className="flex flex-col items-center gap-3 text-center">
          <Logo size={64} />
          <div className="space-y-1">
            <h1 className="text-lg font-semibold">揪帳</h1>
            <p className="text-sm text-muted-foreground">選個方式登入，就這樣。</p>
          </div>
        </div>
        {errorMessage && (
          <p
            role="alert"
            className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {errorMessage}
          </p>
        )}
        <SessionProvider>
          <OAuthButtons
            callbackUrl={callbackUrl}
            showGithub={githubEnabled}
            showGoogle={googleEnabled}
            showLine={lineEnabled}
            inAppBrowser={inAppBrowser}
          />
        </SessionProvider>
      </div>
    </div>
  );
}
