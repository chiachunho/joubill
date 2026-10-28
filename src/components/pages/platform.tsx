"use client";

import { useCallback, useEffect, useState, type ComponentType } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, UserCircle } from "lucide-react";

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

export const miniPlatform: Platform = {
  basePath: "/mini",
  request: tmaFetch,
  rawRequest: tmaRawFetch,
  useSelfPhoto: useTelegramSelfPhoto,
  HeaderLeading: MiniHeaderLeading,
  useBack: useMiniBack,
  BackLink: MiniBackLink,
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
};
