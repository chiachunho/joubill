import { SessionProvider } from "next-auth/react";

import { OAuthButtons } from "@/components/OAuthButtons";
import { TelegramLoginWidget } from "@/components/TelegramLoginWidget";
import { clientEnv, serverEnv } from "@/lib/env";

type Props = { searchParams: Promise<{ next?: string }> };

export default async function LoginPage({ searchParams }: Props) {
  const { next } = await searchParams;
  const { TELEGRAM_BOT_USERNAME } = serverEnv();
  const origin = new URL(clientEnv.NEXT_PUBLIC_MINI_APP_URL).origin;

  const safeNext =
    next && next.startsWith("/") && !next.startsWith("//") ? next : undefined;

  const telegramCallbackBase = `${origin}/api/auth/telegram/callback`;
  const telegramCallbackUrl = safeNext
    ? `${telegramCallbackBase}?next=${encodeURIComponent(safeNext)}`
    : telegramCallbackBase;

  const oauthCallbackUrl = safeNext ?? "/app";

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-8">
        <div className="space-y-2 text-center">
          <h1 className="text-lg font-semibold">Splitbill</h1>
          <p className="text-sm text-muted-foreground">選擇登入方式</p>
        </div>

        <div className="space-y-6">
          {TELEGRAM_BOT_USERNAME ? (
            <div className="space-y-2">
              <p className="sect text-center">Telegram</p>
              <div className="flex justify-center">
                <TelegramLoginWidget
                  botUsername={TELEGRAM_BOT_USERNAME}
                  callbackUrl={telegramCallbackUrl}
                />
              </div>
            </div>
          ) : (
            <p className="text-center text-xs text-destructive">
              Missing env: TELEGRAM_BOT_USERNAME
            </p>
          )}

          <div className="relative flex items-center gap-3">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs text-muted-foreground">或</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          <div className="space-y-2">
            <p className="sect text-center">OAuth</p>
            <SessionProvider>
              <OAuthButtons callbackUrl={oauthCallbackUrl} />
            </SessionProvider>
          </div>
        </div>
      </div>
    </div>
  );
}
