import type { Metadata } from "next";

import { AuthProvider } from "@/components/AuthProvider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { NO_INDEX } from "@/lib/seo";
import { WebStoreProvider } from "@/app/app/StoreProvider";

export const metadata: Metadata = { title: "加入群組", ...NO_INDEX };

// Same providers as /app (see src/app/app/layout.tsx): a shared link lands here, outside /app,
// and still needs the Web App's session-cookie store and its 401 → /login?next=… redirect.
export default function JoinLayout({ children }: { children: React.ReactNode }) {
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
