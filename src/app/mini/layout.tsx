import type { Metadata } from "next";
import Script from "next/script";

import { SWRProvider } from "@/components/mini/SWRProvider";
import { TelegramApp } from "@/components/mini/TelegramApp";

export const metadata: Metadata = {
  title: "Splitbill",
};

export default function MiniLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* Telegram injects this script when launched from a client, but loading it
          here too lets the page render correctly when previewed in a regular
          browser during development. */}
      <Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />
      <TelegramApp>
        <SWRProvider>
          <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-4 px-4 py-6">
            {children}
          </main>
        </SWRProvider>
      </TelegramApp>
    </>
  );
}
