"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, Users } from "lucide-react";
import useSWR from "swr";

import { GroupsListSkeleton } from "@/components/mini/skeletons";
import type { Platform } from "@/components/pages/platform";
import { useLoginRedirect } from "@/components/pages/use-login-redirect";

type MyGroupsResponse = {
  groups: Array<{ id: number; title: string; defaultCurrency: string }>;
  activeGroupId: number | null;
  activeExpenseId: number | null;
  activeSettlementId: number | null;
};

type GroupPhotosResponse = { photos: Record<number, string | null> };

export function GroupsHome({ platform }: { platform: Platform }) {
  const router = useRouter();
  const { data, error } = useSWR<MyGroupsResponse>("/api/me/groups");
  const { data: photosData } = useSWR<GroupPhotosResponse>("/api/me/groups/photos");

  // A Telegram deep link (startapp) names a group, and maybe an expense or settlement in it.
  // Only the Mini App gets one: the endpoint leaves activeGroupId null on the web.
  useEffect(() => {
    if (!data?.activeGroupId) return;
    const group = `${platform.basePath}/groups/${data.activeGroupId}`;
    if (data.activeExpenseId) {
      router.replace(`${group}/expenses/${data.activeExpenseId}/edit`);
    } else if (data.activeSettlementId) {
      router.replace(`${group}/settlements/${data.activeSettlementId}`);
    } else {
      router.replace(group);
    }
  }, [data, router, platform.basePath]);

  const redirectToLogin = useLoginRedirect(error, platform.loginPath);

  if (error && !redirectToLogin) {
    return (
      <div className="px-4 py-12 text-center">
        <p className="text-sm text-muted-foreground">無法載入群組</p>
        <p className="mt-1 text-xs text-muted-foreground/60">{String(error)}</p>
      </div>
    );
  }

  if (!data) return <GroupsListSkeleton />;

  if (data.activeGroupId) return null;

  const { groups } = data;

  return (
    <div className="py-6">
      <platform.HomeHeader />

      {groups.length === 0 ? (
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
          {groups.map((g) => (
            <Link
              key={g.id}
              href={`${platform.basePath}/groups/${g.id}`}
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
