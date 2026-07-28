"use client";

import { useState } from "react";
import Link from "next/link";
import { BookOpen, ChevronLeft, ChevronRight, LogOut, User } from "lucide-react";
import useSWR from "swr";

import { PersonalSettingsSkeleton } from "@/components/mini/skeletons";
import { HELP_PATH } from "@/lib/help-url";

type ProfileResponse = {
  firstName: string;
  lastName: string | null;
  username: string | null;
  photoUrl: string | null;
};

export default function AppSettingsPage() {
  const { data: profile, error } = useSWR<ProfileResponse>("/api/me/profile");
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

  if (error && !String(error).includes("401")) {
    return (
      <div className="px-4 py-12 text-center">
        <p className="text-sm text-muted-foreground">無法載入</p>
        <p className="mt-1 text-xs text-muted-foreground/60">{String(error)}</p>
      </div>
    );
  }

  if (!profile) return <PersonalSettingsSkeleton />;

  const displayName = [profile.firstName, profile.lastName].filter(Boolean).join(" ");

  return (
    <div className="space-y-6 py-4">
      <div className="relative flex items-center justify-center px-4 py-1">
        <Link
          href="/app"
          className="absolute left-4 inline-flex items-center gap-0.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
          返回
        </Link>
        <h1 className="text-sm font-semibold">個人設定</h1>
      </div>

      <section className="px-4">
        <div className="flex items-center gap-4 rounded-2xl bg-secondary/50 px-4 py-4">
          {profile.photoUrl ? (
            <img
              src={profile.photoUrl}
              alt={displayName}
              className="size-12 rounded-full object-cover ring-1 ring-black/10 dark:ring-white/10"
            />
          ) : (
            <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary/10">
              <User className="size-5 text-primary" />
            </div>
          )}
          <div className="min-w-0">
            <p className="truncate font-semibold">{displayName}</p>
            {profile.username && (
              <p className="truncate text-sm text-muted-foreground">@{profile.username}</p>
            )}
          </div>
        </div>
      </section>

      <section className="px-4">
        <p className="sect mb-2.5">關於</p>
        <div className="divide-y divide-border/40 overflow-hidden rounded-2xl bg-secondary/50">
          <Link
            href={HELP_PATH}
            className="flex w-full items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/30 active:bg-accent/50"
          >
            <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
              <BookOpen className="size-3.5 text-primary" />
            </div>
            <span className="flex-1 text-sm">使用說明</span>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground/40" />
          </Link>
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-sm">版本</span>
            <span className="num text-sm text-muted-foreground">
              {process.env.NEXT_PUBLIC_APP_VERSION ?? "—"}
            </span>
          </div>
        </div>
      </section>

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
    </div>
  );
}
