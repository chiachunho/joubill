"use client";

import { use, useEffect, useMemo, useState } from "react";
import useSWR from "swr";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SettlementForm } from "@/components/mini/SettlementForm";

type Member = { id: number; firstName: string; lastName: string | null; username: string | null };
type MeResponse = { userId: number; groups: Array<{ id: number; defaultCurrency: string }> };
type MembersResponse = { members: Member[] };
type AvatarsResponse = { userPhotos: Record<number, string | null> };

type SettlementDetail = {
  id: number;
  amount: number;
  currency: string;
  settledAt: string;
  from: { userId: number };
  to: { userId: number };
};

export default function EditSettlementPage({
  params,
}: {
  params: Promise<{ id: string; settlementId: string }>;
}) {
  const { id, settlementId } = use(params);
  const groupId = Number(id);
  const sid = Number(settlementId);

  const { data: me, error: meError } = useSWR<MeResponse>("/api/me/groups");
  const { data: ms, error: msError } = useSWR<MembersResponse>(`/api/groups/${groupId}/members`);
  const { data: settlement, error: settlementError } = useSWR<SettlementDetail>(
    `/api/groups/${groupId}/settlements/${sid}`,
  );
  const { data: avatars } = useSWR<AvatarsResponse>(`/api/groups/${groupId}/avatars`);

  const [selfPhotoUrl, setSelfPhotoUrl] = useState<string | null>(null);
  useEffect(() => {
    import("@twa-dev/sdk").then(({ default: WebApp }) => {
      setSelfPhotoUrl(WebApp.initDataUnsafe.user?.photo_url ?? null);
    });
  }, []);

  const photos = useMemo<Record<number, string | null>>(() => {
    const base: Record<number, string | null> = { ...(avatars?.userPhotos ?? {}) };
    if (me?.userId && selfPhotoUrl) base[me.userId] = selfPhotoUrl;
    return base;
  }, [avatars, me?.userId, selfPhotoUrl]);

  if (meError || msError || settlementError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>無法載入</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {String(meError ?? msError ?? settlementError)}
        </CardContent>
      </Card>
    );
  }
  if (!me || !ms || !settlement) return <p className="text-muted-foreground">載入中…</p>;

  const group = me.groups.find((g) => g.id === groupId);
  if (!group) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>無法載入</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">你不屬於這個群組</CardContent>
      </Card>
    );
  }

  return (
    <SettlementForm
      groupId={groupId}
      defaultCurrency={group.defaultCurrency}
      members={ms.members}
      photos={photos}
      initial={settlement}
    />
  );
}
