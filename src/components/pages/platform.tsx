"use client";

import { useCallback, useEffect, useState, type ComponentType, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, LogOut, UserCircle } from "lucide-react";

import { HELP_PATH, HELP_URL } from "@/lib/help-url";
import { tmaFetch } from "@/lib/tma-fetch";
import { useTelegramBackButton } from "@/lib/use-tg-back-button";
import { tmaRawFetch, webFetch, webRawFetch } from "@/lib/web-fetch";

/**
 * Everything that differs between the Mini App and the Web App page copies. A page
 * body under `src/components/pages` takes one of these and nothing else platform
 * specific, so the two routes cannot drift apart in the body. Only the thin
 * `page.tsx` wrappers under `src/app/{mini,app}` pass one in.
 */
export type Platform = {
  /** Prefix for in-app links: "/mini" or "/app". */
  basePath: "/mini" | "/app";
  /** Authenticated request: the `tma` initData header in the Mini App, the session cookie in the Web App. */
  request: <T>(path: string, init?: RequestInit) => Promise<T>;
  /** The same request, returning the raw Response so the caller can check `res.ok` itself. */
  rawRequest: (path: string, init?: RequestInit) => Promise<Response>;
  /** The viewer's own Telegram photo, used when the bot has none. A hook, so it may hold state. */
  useSelfPhoto: () => string | null;
  /** The top-left control of the group header. */
  HeaderLeading: ComponentType;
  /**
   * Sends the back action to `href` while the page is mounted. A hook: call it
   * unconditionally at the top of the body, before any early return.
   */
  useBack: (href: string) => void;
  /** The visible back link on this platform, if it has one. */
  BackLink: ComponentType<{ href: string }>;
  /** The header above the group list, including the link to personal settings. */
  HomeHeader: ComponentType;
  /** Where an unauthenticated viewer is sent, or null to show the error instead. */
  loginPath: string | null;
  /** The "使用說明" row. The Mini App opens it in Telegram's browser; the Web App navigates. */
  HelpAction: ComponentType<{ className: string; children: ReactNode }>;
  /** Extra content at the foot of the personal settings page. The Web App has the sign-out button. */
  AccountSection: ComponentType;
};

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

// Opens in Telegram's in-app browser rather than navigating the Mini App's own
// webview: a plain <a> would replace the Mini App and lose its back button.
function MiniHelpAction({ className, children }: { className: string; children: ReactNode }) {
  const openHelp = useCallback(() => {
    import("@twa-dev/sdk")
      .then(({ default: WebApp }) => WebApp.openLink(HELP_URL))
      .catch(() => window.open(HELP_URL, "_blank", "noopener"));
  }, []);
  return (
    <button onClick={openHelp} className={className}>
      {children}
    </button>
  );
}

function MiniAccountSection(): null {
  return null;
}

function useNoSelfPhoto(): string | null {
  return null;
}

function useNoBack(): void {}

function WebHeaderLeading() {
  return (
    <Link
      href="/app"
      className="absolute left-4 inline-flex items-center gap-0.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      <ChevronLeft className="size-4" />
      返回
    </Link>
  );
}

function WebBackLink({ href }: { href: string }) {
  return (
    <Link
      href={href}
      className="mb-1 inline-flex items-center gap-0.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      <ChevronLeft className="size-4" />
      返回
    </Link>
  );
}

function WebHomeHeader() {
  return (
    <div className="mb-3 flex items-center justify-between px-4">
      <p className="sect">我的群組</p>
      <Link
        href="/app/settings"
        className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
      >
        <UserCircle className="size-4" />
      </Link>
    </div>
  );
}

function WebHelpAction({ className, children }: { className: string; children: ReactNode }) {
  return (
    <Link href={HELP_PATH} className={className}>
      {children}
    </Link>
  );
}

function WebAccountSection() {
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    } catch {
      // network error — redirect anyway; server session expires naturally
    }
    window.location.href = "/login";
  }

  return (
    <section className="px-4">
      <div className="overflow-hidden rounded-2xl bg-secondary/50">
        <button
          onClick={handleLogout}
          disabled={loggingOut}
          className="flex w-full items-center gap-3 px-4 py-3 text-sm text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
        >
          <LogOut className="size-4" />
          {loggingOut ? "登出中…" : "登出"}
        </button>
      </div>
    </section>
  );
}

export const miniPlatform: Platform = {
  basePath: "/mini",
  request: tmaFetch,
  rawRequest: tmaRawFetch,
  useSelfPhoto: useTelegramSelfPhoto,
  HeaderLeading: MiniHeaderLeading,
  useBack: useMiniBack,
  BackLink: MiniBackLink,
  HomeHeader: MiniHomeHeader,
  // Telegram authenticates the Mini App from initData, so there is no login page to send anyone to.
  loginPath: null,
  HelpAction: MiniHelpAction,
  AccountSection: MiniAccountSection,
};

export const webPlatform: Platform = {
  basePath: "/app",
  request: webFetch,
  rawRequest: webRawFetch,
  // The Web App has no Telegram SDK, so the bot's avatar is the only photo source.
  useSelfPhoto: useNoSelfPhoto,
  HeaderLeading: WebHeaderLeading,
  useBack: useNoBack,
  BackLink: WebBackLink,
  HomeHeader: WebHomeHeader,
  loginPath: "/login",
  HelpAction: WebHelpAction,
  AccountSection: WebAccountSection,
};
