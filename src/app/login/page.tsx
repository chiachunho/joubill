import { TelegramLoginWidget } from "@/components/TelegramLoginWidget";
import { clientEnv, serverEnv } from "@/lib/env";

export default function LoginPage() {
  const { TELEGRAM_BOT_USERNAME } = serverEnv();
  const origin = new URL(clientEnv.NEXT_PUBLIC_MINI_APP_URL).origin;
  const callbackUrl = `${origin}/api/auth/telegram/callback`;

  if (!TELEGRAM_BOT_USERNAME) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <p className="text-sm text-destructive">
          Missing env: TELEGRAM_BOT_USERNAME
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-8">
        <div className="space-y-2 text-center">
          <h1 className="text-lg font-semibold">Splitbill</h1>
          <p className="text-sm text-muted-foreground">使用 Telegram 帳號登入</p>
        </div>
        <div className="flex justify-center">
          <TelegramLoginWidget botUsername={TELEGRAM_BOT_USERNAME} callbackUrl={callbackUrl} />
        </div>
      </div>
    </div>
  );
}
