"use client";

import { use, useEffect, useMemo, useState } from "react";
import useSWR from "swr";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ExpenseForm } from "@/components/mini/ExpenseForm";
import { FormSkeleton } from "@/components/mini/skeletons";

type Member = { id: number; firstName: string; lastName: string | null; username: string | null };

type MeResponse = {
  userId: number;
  groups: Array<{ id: number; defaultCurrency: string }>;
};

type MembersResponse = { members: Member[] };

type AvatarsResponse = { userPhotos: Record<number, string | null> };

export default function NewExpensePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const groupId = Number(id);

  const { data: me, error: meError } = useSWR<MeResponse>("/api/me/groups");
  const { data: ms, error: msError } = useSWR<MembersResponse>(`/api/groups/${groupId}/members`);
  const { data: avatars } = useSWR<AvatarsResponse>(`/api/groups/${groupId}/avatars`);

  const [selfPhotoUrl, setSelfPhotoUrl] = useState<string | null>(null);
  useEffect(() => {
    import("@twa-dev/sdk").then(({ default: WebApp }) => {
      setSelfPhotoUrl(WebApp.initDataUnsafe.user?.photo_url ?? null);
    });
  }, []);

  const photos = useMemo<Record<number, string | null>>(() => {
    const base: Record<number, string | null> = { ...(avatars?.userPhotos ?? {}) };
    if (me?.userId && selfPhotoUrl && !base[me.userId]) base[me.userId] = selfPhotoUrl;
    return base;
  }, [avatars, me?.userId, selfPhotoUrl]);

  if (meError || msError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>無法載入</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {String(meError ?? msError)}
        </CardContent>
      </Card>
    );
  }
  if (!me || !ms) return <FormSkeleton variant="expense" />;

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
    <ExpenseForm
      groupId={groupId}
      currentUserId={me.userId}
      defaultCurrency={group.defaultCurrency}
      members={ms.members}
      photos={photos}
    />
  );
}
