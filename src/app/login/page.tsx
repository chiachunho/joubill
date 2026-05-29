import { SessionProvider } from "next-auth/react";

import { OAuthButtons } from "@/components/OAuthButtons";

type Props = { searchParams: Promise<{ next?: string }> };

export default async function LoginPage({ searchParams }: Props) {
  const { next } = await searchParams;
  const callbackUrl =
    next && next.startsWith("/") && !next.startsWith("//") ? next : "/app";

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-8">
        <div className="space-y-2 text-center">
          <h1 className="text-lg font-semibold">揪帳</h1>
          <p className="text-sm text-muted-foreground">選個方式登入，就這樣。</p>
        </div>
        <SessionProvider>
          <OAuthButtons callbackUrl={callbackUrl} />
        </SessionProvider>
      </div>
    </div>
  );
}
