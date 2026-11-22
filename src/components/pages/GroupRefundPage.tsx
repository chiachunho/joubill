"use client";

import { use, useMemo } from "react";

import { LoadError } from "@/components/mini/LoadError";
import { RefundForm } from "@/components/mini/RefundForm";
import { FormSkeleton } from "@/components/mini/skeletons";
import type { Platform } from "@/components/pages/platform";
import { describeError } from "@/lib/api-error";
import { expenseEditPath } from "@/lib/record-path";
import {
  useGetAvatarsQuery,
  useGetMeQuery,
  useGetMembersQuery,
  useGetRefundParentQuery,
  useGetRefundQuery,
} from "@/store/api";
import { skipToken } from "@reduxjs/toolkit/query";

/**
 * The refund form's page body (issue #178), shared by `/mini` and `/app`: a new refund on
 * `expenseId`, or an existing one by `refundId`. Either way it returns to the expense.
 */
function GroupRefundPage({
  groupId,
  expenseId,
  refundId,
  platform,
}: {
  groupId: number;
  expenseId?: number;
  refundId?: number;
  platform: Platform;
}) {
  const { data: me, error: meError } = useGetMeQuery();
  const { data: ms, error: msError } = useGetMembersQuery(groupId);
  const { data: avatars } = useGetAvatarsQuery(groupId);
  const { data: refund, error: refundError } = useGetRefundQuery(
    refundId != null ? { groupId, refundId } : skipToken,
  );
  const { data: parent, error: parentError } = useGetRefundParentQuery(
    expenseId != null ? { groupId, expenseId } : skipToken,
  );
  const selfPhotoUrl = platform.useSelfPhoto();
  const selfId = me?.userId;
  const photos = useMemo<Record<number, string | null>>(() => {
    const base: Record<number, string | null> = { ...(avatars?.userPhotos ?? {}) };
    if (selfId && selfPhotoUrl && !base[selfId]) base[selfId] = selfPhotoUrl;
    return base;
  }, [avatars, selfId, selfPhotoUrl]);

  const error = meError ?? msError ?? refundError ?? parentError;
  if (error) return <LoadError detail={describeError(error)} />;
  const expense = refund?.expense ?? parent;
  if (!me || !ms || !expense) return <FormSkeleton variant="expense" />;

  const group = me.groups.find((g) => g.id === groupId);
  if (!group) return <LoadError detail="你不屬於這個群組" />;

  return (
    <RefundForm
      groupId={groupId}
      defaultCurrency={group.defaultCurrency}
      currentUserId={me.userId}
      members={ms.members}
      photos={photos}
      parent={expense}
      initial={refund}
      returnPath={expenseEditPath(platform.basePath, groupId, expense.id)}
    />
  );
}

export function GroupRefundNewPage({
  params,
  platform,
}: {
  params: Promise<{ id: string; expenseId: string }>;
  platform: Platform;
}) {
  const { id, expenseId } = use(params);
  return <GroupRefundPage groupId={Number(id)} expenseId={Number(expenseId)} platform={platform} />;
}

export function GroupRefundEditPage({
  params,
  platform,
}: {
  params: Promise<{ id: string; refundId: string }>;
  platform: Platform;
}) {
  const { id, refundId } = use(params);
  return <GroupRefundPage groupId={Number(id)} refundId={Number(refundId)} platform={platform} />;
}
