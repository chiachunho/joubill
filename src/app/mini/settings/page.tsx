"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, ChevronRight, User } from "lucide-react";
import useSWR from "swr";

import { PersonalSettingsSkeleton } from "@/components/mini/skeletons";
import { HELP_URL } from "@/lib/help-url";
import { useTelegramBackButton } from "@/lib/use-tg-back-button";

type ProfileResponse = {
  firstName: string;
  lastName: string | null;
  username: string | null;
  photoUrl: string | null;
};

export default function PersonalSettingsPage() {
  const router = useRouter();
  const back = useCallback(() => router.push("/mini"), [router]);
  useTelegramBackButton(back);

  // Open in Telegram's in-app browser rather than navigating the Mini App's own
  // webview — a plain <a> would replace the Mini App and lose the back button.
  const openHelp = useCallback(() => {
    import("@twa-dev/sdk")
      .then(({ default: WebApp }) => WebApp.openLink(HELP_URL))
      .catch(() => window.open(HELP_URL, "_blank", "noopener"));
  }, []);

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
      <div className="px-4">
        <h1 className="text-lg font-semibold">個人設定</h1>
      </div>

      <section className="px-4">
        <div className="flex items-center gap-4 rounded-2xl bg-secondary/50 px-4 py-4">
          {profile.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
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
          <button
            onClick={openHelp}
            className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/30 active:bg-accent/50"
          >
            <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
              <BookOpen className="size-3.5 text-primary" />
            </div>
            <span className="flex-1 text-sm">使用說明</span>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground/40" />
          </button>
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-sm">版本</span>
            <span className="num text-sm text-muted-foreground">
              {process.env.NEXT_PUBLIC_APP_VERSION ?? "—"}
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}
