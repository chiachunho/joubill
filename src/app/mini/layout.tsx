import type { Metadata } from "next";
import Script from "next/script";

import { AuthProvider } from "@/components/AuthProvider";
import { SWRProvider } from "@/components/mini/SWRProvider";
import { TelegramApp } from "@/components/mini/TelegramApp";

export const metadata: Metadata = {
  title: "揪帳",
};

export default function MiniLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* Telegram injects this script when launched from a client, but loading it
          here too lets the page render correctly when previewed in a regular
          browser during development. */}
      <Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />
      <AuthProvider mode="tma">
        <TelegramApp>
          <SWRProvider>
            <main className="mx-auto min-h-screen max-w-xl pb-10">
              {children}
            </main>
          </SWRProvider>
        </TelegramApp>
      </AuthProvider>
    </>
  );
}
