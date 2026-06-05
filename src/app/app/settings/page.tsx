"use client";

import Link from "next/link";
import { ChevronLeft, LogOut, User } from "lucide-react";
import useSWR from "swr";

import { PersonalSettingsSkeleton } from "@/components/mini/skeletons";

type ProfileResponse = {
  firstName: string;
  lastName: string | null;
  username: string | null;
};

async function logout() {
  await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
  window.location.href = "/login";
}

export default function AppSettingsPage() {
  const { data: profile, error } = useSWR<ProfileResponse>("/api/me/profile");

  if (error) {
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
          <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary/10">
            <User className="size-5 text-primary" />
          </div>
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
            onClick={logout}
            className="flex w-full items-center gap-3 px-4 py-3 text-sm text-destructive transition-colors hover:bg-destructive/10"
          >
            <LogOut className="size-4" />
            登出
          </button>
        </div>
      </section>
    </div>
  );
}
