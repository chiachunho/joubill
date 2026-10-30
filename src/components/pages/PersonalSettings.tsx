"use client";

import { BookOpen, ChevronRight, User } from "lucide-react";

import { LoginMethodsSection } from "@/components/pages/LoginMethodsSection";
import { PersonalSettingsSkeleton } from "@/components/mini/skeletons";
import type { Platform } from "@/components/pages/platform";
import { useLoginRedirect } from "@/components/pages/use-login-redirect";
import { describeError } from "@/lib/api-error";
import { useGetProfileQuery } from "@/store/api";

export function PersonalSettings({ platform }: { platform: Platform }) {
  platform.useBack(platform.basePath);

  const { data: profile, error } = useGetProfileQuery();
  const redirectToLogin = useLoginRedirect(error, platform.loginPath);

  if (error && !redirectToLogin) {
    return (
      <div className="px-4 py-12 text-center">
        <p className="text-sm text-muted-foreground">無法載入</p>
        <p className="mt-1 text-xs text-muted-foreground/60">{describeError(error)}</p>
      </div>
    );
  }

  if (!profile) return <PersonalSettingsSkeleton />;

  const displayName = [profile.firstName, profile.lastName].filter(Boolean).join(" ");

  return (
    <div className="space-y-6 py-4">
      <div className="px-4">
        <platform.BackLink href={platform.basePath} />
        <h1 className="text-lg font-semibold">個人設定</h1>
      </div>

      <section className="px-4">
        <div className="flex items-center gap-4 rounded-2xl bg-secondary/50 px-4 py-4">
          {profile.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={profile.photoUrl}
              alt={displayName}
              referrerPolicy="no-referrer"
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

      <LoginMethodsSection platform={platform} />

      <section className="px-4">
        <p className="sect mb-2.5">關於</p>
        <div className="divide-y divide-border/40 overflow-hidden rounded-2xl bg-secondary/50">
          <platform.HelpAction className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/30 active:bg-accent/50">
            <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
              <BookOpen className="size-3.5 text-primary" />
            </div>
            <span className="flex-1 text-sm">使用說明</span>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground/40" />
          </platform.HelpAction>
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-sm">版本</span>
            <span className="num text-sm text-muted-foreground">
              {process.env.NEXT_PUBLIC_APP_VERSION ?? "—"}
            </span>
          </div>
        </div>
      </section>

      <platform.AccountSection />
    </div>
  );
}
