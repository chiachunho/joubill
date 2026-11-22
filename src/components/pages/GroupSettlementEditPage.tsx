"use client";

import { use, useMemo } from "react";

import { LoadError } from "@/components/mini/LoadError";
import { SettlementForm } from "@/components/mini/SettlementForm";
import { FormSkeleton } from "@/components/mini/skeletons";
import type { Platform } from "@/components/pages/platform";
import { describeError } from "@/lib/api-error";
import {
  useGetAvatarsQuery,
  useGetMeQuery,
  useGetMembersQuery,
  useGetSettlementQuery,
} from "@/store/api";

export function GroupSettlementEditPage({
  params,
  platform,
}: {
  params: Promise<{ id: string; settlementId: string }>;
  platform: Platform;
}) {
  const { id, settlementId } = use(params);
  const groupId = Number(id);
  const sid = Number(settlementId);

  const { data: me, error: meError } = useGetMeQuery();
  const { data: ms, error: msError } = useGetMembersQuery(groupId);
  const { data: settlement, error: settlementError } = useGetSettlementQuery({
    groupId,
    settlementId: sid,
  });
  const { data: avatars } = useGetAvatarsQuery(groupId);

  const selfPhotoUrl = platform.useSelfPhoto();

  const selfId = me?.userId;
  const photos = useMemo<Record<number, string | null>>(() => {
    const base: Record<number, string | null> = { ...(avatars?.userPhotos ?? {}) };
    if (selfId && selfPhotoUrl && !base[selfId]) base[selfId] = selfPhotoUrl;
    return base;
  }, [avatars, selfId, selfPhotoUrl]);

  if (meError || msError || settlementError) {
    return <LoadError detail={describeError(meError ?? msError ?? settlementError)} />;
  }
  if (!me || !ms || !settlement) return <FormSkeleton variant="settlement" />;

  const group = me.groups.find((g) => g.id === groupId);
  if (!group) {
    return <LoadError detail="你不屬於這個群組" />;
  }

  return (
    <SettlementForm
      groupId={groupId}
      defaultCurrency={group.defaultCurrency}
      currentUserId={me.userId}
      members={ms.members}
      photos={photos}
      returnPath={`${platform.basePath}/groups/${groupId}`}
      initial={settlement}
    />
  );
}
