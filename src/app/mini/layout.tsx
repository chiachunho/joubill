import type { Metadata } from "next";
import Script from "next/script";

import { AuthProvider } from "@/components/AuthProvider";
import { StoreProvider } from "./StoreProvider";
import { TelegramApp } from "@/components/mini/TelegramApp";
import { TooltipProvider } from "@/components/ui/tooltip";
import { NO_INDEX } from "@/lib/seo";

export const metadata: Metadata = {
  title: { absolute: "揪帳" },
  ...NO_INDEX,
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
          <StoreProvider>
            <TooltipProvider delayDuration={200}>
              <main className="mx-auto min-h-screen max-w-xl pb-10">{children}</main>
            </TooltipProvider>
          </StoreProvider>
        </TelegramApp>
      </AuthProvider>
    </>
  );
}
