"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { User } from "lucide-react";

import { PersonalSettingsSkeleton } from "@/components/mini/skeletons";
import { useTelegramBackButton } from "@/lib/use-tg-back-button";

type TgUser = {
  firstName: string;
  lastName?: string;
  username?: string;
  photoUrl?: string;
};

export default function PersonalSettingsPage() {
  const router = useRouter();
  // Fall back to the groups list if there is no history to go back to
  const back = useCallback(() => router.push("/mini"), [router]);
  useTelegramBackButton(back);

  const [user, setUser] = useState<TgUser | null>(null);

  useEffect(() => {
    import("@twa-dev/sdk")
      .then(({ default: WebApp }) => {
        const u = WebApp.initDataUnsafe.user;
        setUser(
          u
            ? { firstName: u.first_name, lastName: u.last_name, username: u.username, photoUrl: u.photo_url }
            : { firstName: "使用者" },
        );
      })
      .catch(() => {
        setUser({ firstName: "使用者" });
      });
  }, []);

  if (!user) return <PersonalSettingsSkeleton />;

  const displayName = [user.firstName, user.lastName].filter(Boolean).join(" ");

  return (
    <div className="space-y-6 py-4">
      <div className="px-4">
        <h1 className="text-lg font-semibold">個人設定</h1>
      </div>

      <section className="px-4">
        <div className="flex items-center gap-4 rounded-2xl bg-secondary/50 px-4 py-4">
          {user.photoUrl ? (
            <img
              src={user.photoUrl}
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
            {user.username && (
              <p className="truncate text-sm text-muted-foreground">@{user.username}</p>
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
    </div>
  );
}
