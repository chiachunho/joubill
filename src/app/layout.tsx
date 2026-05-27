import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Splitbill",
  description: "Telegram 群組分帳 Bot + Mini App",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant" suppressHydrationWarning>
      <body className="min-h-screen bg-background font-sans antialiased">{children}</body>
    </html>
  );
}
