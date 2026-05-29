import type { Metadata } from "next";

import { AuthProvider } from "@/components/AuthProvider";

import { WebSWRProvider } from "./SWRProvider";

export const metadata: Metadata = { title: "Splitbill" };

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider mode="web">
      <WebSWRProvider>
        <main className="mx-auto min-h-screen max-w-xl pb-10">{children}</main>
      </WebSWRProvider>
    </AuthProvider>
  );
}
