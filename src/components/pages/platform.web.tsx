"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { ChevronLeft, LogOut, UserCircle } from "lucide-react";

import type { Platform } from "@/components/pages/platform";
import { WEB_LOGIN_PATH } from "@/lib/auth-redirect";
import { HELP_PATH } from "@/lib/help-url";
import type { LoginProvider } from "@/lib/identities";
import { webRawFetch } from "@/lib/web-fetch";

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
    window.location.href = WEB_LOGIN_PATH;
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

function linkIdentity(provider: LoginProvider): void {
  // With a session, Auth.js links the new account to the signed-in user (or fails with
  // OAuthAccountNotLinked if it belongs to someone else) instead of creating a user.
  void signIn(provider, { callbackUrl: "/app/settings" });
}

export const webPlatform: Platform = {
  basePath: "/app",
  rawRequest: webRawFetch,
  // The Web App has no Telegram SDK, so the bot's avatar is the only photo source.
  useSelfPhoto: useNoSelfPhoto,
  HeaderLeading: WebHeaderLeading,
  useBack: useNoBack,
  BackLink: WebBackLink,
  HomeHeader: WebHomeHeader,
  loginPath: WEB_LOGIN_PATH,
  HelpAction: WebHelpAction,
  canDownloadExport: true,
  linkIdentity,
  AccountSection: WebAccountSection,
};
