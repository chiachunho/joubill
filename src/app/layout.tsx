import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { LAUNCH_SCRIPT } from "@/lib/pwa";
import { SITE_DESCRIPTION, SITE_NAME, SITE_TITLE, siteOrigin } from "@/lib/seo";
import "./globals.css";

export const metadata: Metadata = {
  // Relative URLs below (canonical, the social card) resolve against this. Unset, they stay
  // relative, which is only ever the case for a build without NEXT_PUBLIC_MINI_APP_URL.
  metadataBase: siteOrigin() ? new URL(siteOrigin()!) : undefined,
  title: { default: SITE_TITLE, template: `%s｜${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    locale: "zh_TW",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
  twitter: { card: "summary_large_image", title: SITE_TITLE, description: SITE_DESCRIPTION },
  icons: {
    icon: [
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: { url: "/apple-touch-icon.png" },
  },
  manifest: "/site.webmanifest",
  // Added to the iPhone home screen, the Web App opens full screen like an app. Push
  // notifications only reach it there (iOS 16.4+), never a Safari tab.
  appleWebApp: { capable: true, title: "揪帳", statusBarStyle: "default" },
};

// The page background (米白). Only the Mini App switches to dark, following Telegram's theme;
// the Web App is always light, so one colour is right for its status bar.
export const viewport: Viewport = { themeColor: "#F2F0EB" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant" suppressHydrationWarning>
      <head>
        {/* First, before any rendering or request: opens the iPhone home-screen app at 我的群組
            and drops the notification marker from the address (see LAUNCH_SCRIPT). */}
        <script dangerouslySetInnerHTML={{ __html: LAUNCH_SCRIPT }} />
        {/* TODO: switch to next/font/google (Chiron_GoRound_TC) once Next.js adds it to its font list */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font -- see the TODO above: next/font has no Chiron_GoRound_TC yet */}
        <link
          href="https://fonts.googleapis.com/css2?family=Chiron+GoRound+TC:wght@300;400;500;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen bg-background font-sans antialiased">
        {children}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
