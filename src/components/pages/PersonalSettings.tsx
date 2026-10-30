"use client";

import { useState } from "react";
import { BookOpen, ChevronRight, Pencil, User } from "lucide-react";

import { AvatarSourceDialog } from "@/components/mini/AvatarSourceDialog";
import { DisplayNameDialog } from "@/components/mini/DisplayNameDialog";
import { LoginMethodsSection } from "@/components/pages/LoginMethodsSection";
import { PersonalSettingsSkeleton } from "@/components/mini/skeletons";
import type { Platform } from "@/components/pages/platform";
import { useLoginRedirect } from "@/components/pages/use-login-redirect";
import { describeError } from "@/lib/api-error";
import { displayName as nameOf, providerName as providerNameOf } from "@/lib/profile";
import { useGetProfileQuery } from "@/store/api";

export function PersonalSettings({ platform }: { platform: Platform }) {
  platform.useBack(platform.basePath);

  const { data: profile, error } = useGetProfileQuery();
  const redirectToLogin = useLoginRedirect(error, platform.loginPath);
  const [editing, setEditing] = useState<"name" | "avatar" | null>(null);

  if (error && !redirectToLogin) {
    return (
      <div className="px-4 py-12 text-center">
        <p className="text-sm text-muted-foreground">無法載入</p>
        <p className="mt-1 text-xs text-muted-foreground/60">{describeError(error)}</p>
      </div>
    );
  }

  if (!profile) return <PersonalSettingsSkeleton />;

  const displayName = nameOf(profile);
  const providerName = providerNameOf(profile) || displayName;
  // One picture to choose from is no choice: the avatar only becomes a button with two or more.
  const canChooseAvatar = profile.avatarOptions.length > 1;
  const avatar = profile.photoUrl ? (
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
  );

  return (
    <div className="space-y-6 py-4">
      <div className="px-4">
        <platform.BackLink href={platform.basePath} />
        <h1 className="text-lg font-semibold">個人設定</h1>
      </div>

      <section className="px-4">
        <div className="flex items-center gap-4 rounded-2xl bg-secondary/50 px-4 py-4">
          {canChooseAvatar ? (
            <button
              type="button"
              onClick={() => setEditing("avatar")}
              aria-label="更換頭像"
              className="relative shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {avatar}
              <span className="absolute -bottom-0.5 -right-0.5 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground ring-2 ring-background">
                <Pencil className="size-2.5" />
              </span>
            </button>
          ) : (
            avatar
          )}
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1">
              <p className="truncate font-semibold">{displayName}</p>
              <button
                type="button"
                onClick={() => setEditing("name")}
                aria-label="編輯顯示名稱"
                className="shrink-0 rounded-lg p-1 text-muted-foreground transition-colors hover:bg-accent/30 hover:text-foreground active:bg-accent/50"
              >
                <Pencil className="size-3.5" />
              </button>
            </div>
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

      <DisplayNameDialog
        open={editing === "name"}
        onOpenChange={(open) => setEditing(open ? "name" : null)}
        current={profile.displayName}
        providerName={providerName}
      />
      <AvatarSourceDialog
        open={editing === "avatar"}
        onOpenChange={(open) => setEditing(open ? "avatar" : null)}
        profile={profile}
        name={displayName}
      />
    </div>
  );
}
