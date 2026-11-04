"use client";

import { use, useMemo } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SettlementForm } from "@/components/mini/SettlementForm";
import { FormSkeleton } from "@/components/mini/skeletons";
import type { Platform } from "@/components/pages/platform";
import { describeError } from "@/lib/api-error";
import { useGetAvatarsQuery, useGetMeQuery, useGetMembersQuery } from "@/store/api";

export function GroupSettlementNewPage({
  params,
  platform,
}: {
  params: Promise<{ id: string }>;
  platform: Platform;
}) {
  const { id } = use(params);
  const groupId = Number(id);

  const { data: me, error: meError } = useGetMeQuery();
  const { data: ms, error: msError } = useGetMembersQuery(groupId);
  const { data: avatars } = useGetAvatarsQuery(groupId);

  const selfPhotoUrl = platform.useSelfPhoto();

  const selfId = me?.userId;
  const photos = useMemo<Record<number, string | null>>(() => {
    const base: Record<number, string | null> = { ...(avatars?.userPhotos ?? {}) };
    if (selfId && selfPhotoUrl && !base[selfId]) base[selfId] = selfPhotoUrl;
    return base;
  }, [avatars, selfId, selfPhotoUrl]);

  if (meError || msError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>無法載入</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {describeError(meError ?? msError)}
        </CardContent>
      </Card>
    );
  }
  if (!me || !ms) return <FormSkeleton variant="settlement" />;

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
      photos={photos}
      returnPath={`${platform.basePath}/groups/${groupId}`}
    />
  );
}
