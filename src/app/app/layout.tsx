import type { Metadata } from "next";

import { AuthProvider } from "@/components/AuthProvider";
import { ServiceWorkerRegistrar } from "@/components/pwa/ServiceWorkerRegistrar";
import { TooltipProvider } from "@/components/ui/tooltip";

import { WebStoreProvider } from "./StoreProvider";

export const metadata: Metadata = { title: "揪帳" };

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider mode="web">
      <ServiceWorkerRegistrar />
      <WebStoreProvider>
        <TooltipProvider delayDuration={200}>
          <main className="mx-auto min-h-screen max-w-xl pb-10">{children}</main>
        </TooltipProvider>
      </WebStoreProvider>
    </AuthProvider>
  );
}
