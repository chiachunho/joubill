"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import useSWR from "swr";

import { Avatar } from "@/components/mini/Avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
      <Card>
        <CardHeader>
          <CardTitle>無法載入</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">{String(error)}</CardContent>
      </Card>
    );
  }
  if (!data) return <p className="text-muted-foreground">載入中…</p>;

  return (
    <>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">還款記錄</h1>
        <Button asChild size="sm">
          <Link href={`/mini/groups/${id}/settlements/new`}>
            <Plus />
            新增
          </Link>
        </Button>
      </div>

      <Card>
        <CardContent className="pt-4">
          {data.settlements.length === 0 ? (
            <p className="text-sm text-muted-foreground">尚無還款記錄</p>
          ) : (
            <ul className="divide-y text-sm">
              {data.settlements.map((s) => {
                const date = new Date(s.settledAt).toISOString().slice(5, 10).replace("-", "/");
                return (
                  <li key={s.id}>
                    <Link
                      href={`/mini/groups/${id}/settlements/${s.id}`}
                      className="flex items-center gap-2 py-2 first:pt-0 last:pb-0 hover:bg-accent/40 -mx-2 px-2 rounded"
                    >
                      <span className="flex items-center gap-1.5 flex-1 min-w-0">
                        <Avatar
                          src={getPhoto(s.from.userId)}
                          name={labelUser(s.from)}
                          userId={s.from.userId}
                          size="sm"
                        />
                        <span className="truncate">{labelUser(s.from, selfUserId)}</span>
                        <span className="text-muted-foreground shrink-0">→</span>
                        <Avatar
                          src={getPhoto(s.to.userId)}
                          name={labelUser(s.to)}
                          userId={s.to.userId}
                          size="sm"
                        />
                        <span className="truncate">{labelUser(s.to, selfUserId)}</span>
                      </span>
                      <span className="tabular-nums shrink-0">
                        {fmt(s.amount)} {s.currency}
                      </span>
                      <span className="text-muted-foreground shrink-0 text-xs">{date}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
