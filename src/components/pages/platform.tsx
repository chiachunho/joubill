"use client";

import { useEffect, useState, type ComponentType } from "react";
import Link from "next/link";
import { ChevronLeft, UserCircle } from "lucide-react";

import { tmaFetch } from "@/lib/tma-fetch";
import { webFetch } from "@/lib/web-fetch";

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
  /** The viewer's own Telegram photo, used when the bot has none. A hook, so it may hold state. */
  useSelfPhoto: () => string | null;
  /** The top-left control of the group header. */
  HeaderLeading: ComponentType;
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

function useNoSelfPhoto(): string | null {
  return null;
}

export const miniPlatform: Platform = {
  basePath: "/mini",
  request: tmaFetch,
  useSelfPhoto: useTelegramSelfPhoto,
  HeaderLeading: MiniHeaderLeading,
};

export const webPlatform: Platform = {
  basePath: "/app",
  request: webFetch,
  // The Web App has no Telegram SDK, so the bot's avatar is the only photo source.
  useSelfPhoto: useNoSelfPhoto,
  HeaderLeading: WebHeaderLeading,
};
