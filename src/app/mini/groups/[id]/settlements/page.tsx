"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Plus } from "lucide-react";
import useSWR from "swr";

import { Avatar } from "@/components/mini/Avatar";
import { SettlementsSkeleton } from "@/components/mini/skeletons";
import { labelUser } from "@/lib/label";
import { useTelegramBackButton } from "@/lib/use-tg-back-button";

type Profile = {
  userId: number;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
};

type SettlementsResponse = {
  settlements: Array<{
    id: number;
    amount: number;
    currency: string;
    settledAt: string;
    from: Profile;
    to: Profile;
  }>;
};

type MeResponse = { userId: number };
type AvatarsResponse = { groupPhoto: string | null; userPhotos: Record<number, string | null> };

function fmt(amount: number) {
  return amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function monthLabel(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default function SettlementsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const back = useCallback(() => router.push(`/mini/groups/${id}`), [router, id]);
  useTelegramBackButton(back);

  const { data: me } = useSWR<MeResponse>("/api/me/groups");
  const selfUserId = me?.userId;

  const [selfPhotoUrl, setSelfPhotoUrl] = useState<string | null>(null);
  useEffect(() => {
    import("@twa-dev/sdk").then(({ default: WebApp }) => {
      setSelfPhotoUrl(WebApp.initDataUnsafe.user?.photo_url ?? null);
    });
  }, []);

  const { data, error } = useSWR<SettlementsResponse>(`/api/groups/${id}/settlements`);
  const { data: avatars } = useSWR<AvatarsResponse>(`/api/groups/${id}/avatars`);

  function getPhoto(userId: number): string | null {
    if (selfUserId !== undefined && userId === selfUserId && selfPhotoUrl) return selfPhotoUrl;
    return avatars?.userPhotos[userId] ?? null;
  }

  if (error) {
    return (
      <div className="px-4 py-12 text-center">
        <p className="text-sm text-muted-foreground">無法載入</p>
        <p className="mt-1 text-xs text-muted-foreground/60">{String(error)}</p>
      </div>
    );
  }

  if (!data) return <SettlementsSkeleton />;

  // Group by month
  const byMonth = new Map<string, typeof data.settlements>();
  for (const s of data.settlements) {
    const m = monthLabel(s.settledAt);
    if (!byMonth.has(m)) byMonth.set(m, []);
    byMonth.get(m)!.push(s);
  }

  return (
    <div className="space-y-6 py-4">
      <div className="flex items-center justify-between px-4">
        <h1 className="text-lg font-semibold">還款記錄</h1>
        <Link
          href={`/mini/groups/${id}/settlements/new`}
          className="inline-flex items-center gap-1 rounded-xl bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          <Plus className="size-3" />
          新增
        </Link>
      </div>

      {data.settlements.length === 0 ? (
        <div className="mx-4 rounded-2xl bg-secondary/50 px-4 py-8 text-center">
          <p className="text-sm text-muted-foreground">尚無還款記錄</p>
        </div>
      ) : (
        <div className="space-y-4 px-4">
          {Array.from(byMonth.entries()).map(([month, settlements]) => (
            <div key={month}>
              <p className="mb-2 text-xs font-medium text-muted-foreground">{month}</p>
              <div className="overflow-hidden rounded-2xl bg-secondary/50 divide-y divide-border/40">
                {settlements.map((s) => {
                  const day = new Date(s.settledAt).toISOString().slice(8, 10);
                  return (
                    <Link
                      key={s.id}
                      href={`/mini/groups/${id}/settlements/${s.id}`}
                      className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/30 active:bg-accent/50"
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-1.5">
                        <Avatar
                          src={getPhoto(s.from.userId)}
                          name={labelUser(s.from)}
                          userId={s.from.userId}
                          size="sm"
                        />
                        <span className="max-w-[72px] truncate text-sm">
                          {labelUser(s.from, selfUserId)}
                        </span>
                        <ArrowRight className="size-3 shrink-0 text-muted-foreground/50" />
                        <Avatar
                          src={getPhoto(s.to.userId)}
                          name={labelUser(s.to)}
                          userId={s.to.userId}
                          size="sm"
                        />
                        <span className="max-w-[72px] truncate text-sm">
                          {labelUser(s.to, selfUserId)}
                        </span>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="num text-sm font-semibold">
                          {fmt(s.amount)}{" "}
                          <span className="text-xs font-normal text-muted-foreground">{s.currency}</span>
                        </p>
                        <p className="text-xs text-muted-foreground">{day} 日</p>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
