"use client";

import { useEffect } from "react";
import Link from "next/link";
import { ChevronRight, UserCircle, Users } from "lucide-react";
import useSWR from "swr";

import { GroupsListSkeleton } from "@/components/mini/skeletons";

type MyGroupsResponse = {
  groups: Array<{ id: number; title: string; defaultCurrency: string }>;
  activeGroupId: number | null;
};

type GroupPhotosResponse = { photos: Record<number, string | null> };

export default function AppHome() {
  const { data, error } = useSWR<MyGroupsResponse>("/api/me/groups");
  const { data: photosData } = useSWR<GroupPhotosResponse>("/api/me/groups/photos");

  useEffect(() => {
    if (error && String(error).includes("401")) {
      window.location.href = "/login";
    }
  }, [error]);

  if (error && !String(error).includes("401")) {
    return (
      <div className="px-4 py-12 text-center">
        <p className="text-sm text-muted-foreground">無法載入群組</p>
        <p className="mt-1 text-xs text-muted-foreground/60">{String(error)}</p>
      </div>
    );
  }

  if (!data) return <GroupsListSkeleton />;

  return (
    <div className="py-6">
      <div className="mb-3 flex items-center justify-between px-4">
        <p className="sect">我的群組</p>
        <Link
          href="/app/settings"
          className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <UserCircle className="size-4" />
        </Link>
      </div>

      {data.groups.length === 0 ? (
        <div className="px-4 py-20 text-center">
          <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-secondary">
            <Users className="size-6 text-muted-foreground" />
          </div>
          <p className="font-semibold">還沒有任何群組</p>
          <p className="mt-1 text-sm text-muted-foreground">
            把 Bot 加進 Telegram 群組，輸入 /start 即可
          </p>
        </div>
      ) : (
        <div className="mx-4 divide-y divide-border/50 overflow-hidden rounded-2xl bg-secondary/50">
          {data.groups.map((g) => (
            <Link
              key={g.id}
              href={`/app/groups/${g.id}`}
              className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-accent/40 active:bg-accent/60"
            >
              {photosData?.photos[g.id] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={photosData.photos[g.id]!}
                  alt={g.title}
                  className="size-9 shrink-0 rounded-full object-cover ring-1 ring-black/10 dark:ring-white/10"
                />
              ) : (
                <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10">
                  <Users className="size-4 text-primary" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{g.title}</p>
                <p className="text-xs text-muted-foreground">{g.defaultCurrency}</p>
              </div>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground/40" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
