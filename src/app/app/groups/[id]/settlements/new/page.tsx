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

export default function AppNewSettlementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const groupId = Number(id);

  const { data: me, error: meError } = useSWR<MeResponse>("/api/me/groups");
  const { data: ms, error: msError } = useSWR<MembersResponse>(`/api/groups/${groupId}/members`);
  const { data: avatars } = useSWR<AvatarsResponse>(`/api/groups/${groupId}/avatars`);

  if (meError ?? msError) {
    return (
      <Card><CardHeader><CardTitle>無法載入</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">{String(meError ?? msError)}</CardContent>
      </Card>
    );
  }
  if (!me || !ms) return <FormSkeleton variant="settlement" />;

  const group = me.groups.find((g) => g.id === groupId);
  if (!group) {
    return (
      <Card><CardHeader><CardTitle>無法載入</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">你不屬於這個群組</CardContent>
      </Card>
    );
  }

  return (
    <SettlementForm
      groupId={groupId}
      defaultCurrency={group.defaultCurrency}
      members={ms.members}
      photos={avatars?.userPhotos}
      returnPath={`/app/groups/${groupId}`}
    />
  );
}
