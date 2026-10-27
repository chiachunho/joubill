"use client";

import { use } from "react";
import useSWR from "swr";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SettlementForm } from "@/components/mini/SettlementForm";
import { FormSkeleton } from "@/components/mini/skeletons";

type Member = { id: number; firstName: string; lastName: string | null; username: string | null };
type MeResponse = { userId: number; groups: Array<{ id: number; defaultCurrency: string }> };
type MembersResponse = { members: Member[] };
type AvatarsResponse = { userPhotos: Record<number, string | null> };
type SettlementDetail = {
  id: number;
  createdBy: number | null;
  createdAt: string | null;
  lastActivity: { actorId: number | null; at: string } | null;
  amount: number;
  currency: string;
  fxRate: number | null;
  fxQuote: string | null;
  settledAt: string;
  from: { userId: number };
  to: { userId: number };
};

export default function AppEditSettlementPage({
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

  if (meError ?? msError ?? settlementError) {
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
  if (!me || !ms || !settlement) return <FormSkeleton variant="settlement" />;

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
      currentUserId={me.userId}
      members={ms.members}
      photos={avatars?.userPhotos}
      initial={settlement}
      returnPath={`/app/groups/${groupId}`}
    />
  );
}
