"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { UserCircle } from "lucide-react";

import type { Platform } from "@/components/pages/platform";
import { appUrl, HELP_PATH } from "@/lib/help-url";
import { tmaRawFetch } from "@/lib/tma-fetch";
import { useTelegramBackButton } from "@/lib/use-tg-back-button";

function useTelegramSelfPhoto(): string | null {
  const [photo, setPhoto] = useState<string | null>(null);
  useEffect(() => {
    import("@twa-dev/sdk").then(({ default: WebApp }) => {
      setPhoto(WebApp.initDataUnsafe.user?.photo_url ?? null);
    });
  }, []);
  return photo;
}

function MiniHeaderLeading() {
  return (
    <Link
      href="/mini/settings"
      className="absolute left-4 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
    >
      <UserCircle className="size-4" />
    </Link>
  );
}

function useMiniBack(href: string): void {
  const router = useRouter();
  const back = useCallback(() => router.push(href), [router, href]);
  useTelegramBackButton(back);
}

// Telegram's own back button takes the place of a visible link.
function MiniBackLink(): null {
  return null;
}

function MiniHomeHeader() {
  return (
    <>
      <div className="relative mb-6 flex items-center justify-center px-4">
        <p className="text-sm font-semibold text-foreground">揪帳</p>
        <Link
          href="/mini/settings"
          className="absolute right-4 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <UserCircle className="size-4" />
        </Link>
      </div>
      <p className="sect mb-3 px-4">我的群組</p>
    </>
  );
}

// Opens outside the Mini App's own webview: a plain <a> would replace the Mini App and
// lose its back button.
function openInBrowser(path: string): void {
  const url = appUrl(path);
  import("@twa-dev/sdk")
    .then(({ default: WebApp }) => WebApp.openLink(url))
    .catch(() => window.open(url, "_blank", "noopener"));
}

function MiniHelpAction({ className, children }: { className: string; children: ReactNode }) {
  return (
    <button onClick={() => openInBrowser(HELP_PATH)} className={className}>
      {children}
    </button>
  );
}

// Telegram supplies the identity, so there is nothing to sign out of.
function MiniAccountSection(): null {
  return null;
}

export const miniPlatform: Platform = {
  basePath: "/mini",
  rawRequest: tmaRawFetch,
  useSelfPhoto: useTelegramSelfPhoto,
  HeaderLeading: MiniHeaderLeading,
  useBack: useMiniBack,
  BackLink: MiniBackLink,
  HomeHeader: MiniHomeHeader,
  // Telegram authenticates the Mini App from initData, so there is no login page to send anyone to.
  loginPath: null,
  HelpAction: MiniHelpAction,
  canDownloadExport: false,
  inviteHint: ({ telegramLink }) =>
    telegramLink
      ? "在 Telegram 裡請傳 Telegram 連結，對方點開會直接進 Mini App；網頁連結在 Telegram 點開會跳到外部瀏覽器。"
      : "網頁連結在 Telegram 點開會跳到外部瀏覽器。也可以把邀請碼傳給對方，請他在 Mini App 的「輸入邀請碼」貼上。",
  linkIdentity: null,
  openInBrowser,
  AccountSection: MiniAccountSection,
};
