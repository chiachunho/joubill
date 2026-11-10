import type { Metadata } from "next";

import { AuthProvider } from "@/components/AuthProvider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { NO_INDEX } from "@/lib/seo";

import { WebStoreProvider } from "./StoreProvider";

export const metadata: Metadata = { title: { absolute: "揪帳" }, ...NO_INDEX };

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider mode="web">
      <WebStoreProvider>
        <TooltipProvider delayDuration={200}>
          <main className="mx-auto min-h-screen max-w-xl pb-10">{children}</main>
        </TooltipProvider>
      </WebStoreProvider>
    </AuthProvider>
  );
}
