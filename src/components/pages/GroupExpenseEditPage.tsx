"use client";

import { use, useMemo } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ExpenseForm } from "@/components/mini/ExpenseForm";
import { FormSkeleton } from "@/components/mini/skeletons";
import type { Platform } from "@/components/pages/platform";
import { describeError } from "@/lib/api-error";
import {
  useGetAvatarsQuery,
  useGetExpenseQuery,
  useGetMeQuery,
  useGetMembersQuery,
} from "@/store/api";

export function GroupExpenseEditPage({
  params,
  platform,
}: {
  params: Promise<{ id: string; expenseId: string }>;
  platform: Platform;
}) {
  const { id, expenseId } = use(params);
  const groupId = Number(id);
  const eid = Number(expenseId);

  const { data: me, error: meError } = useGetMeQuery();
  const { data: ms, error: msError } = useGetMembersQuery(groupId);
  const { data: exp, error: expError } = useGetExpenseQuery({ groupId, expenseId: eid });
  const { data: avatars } = useGetAvatarsQuery(groupId);

  const selfPhotoUrl = platform.useSelfPhoto();

  const photos = useMemo<Record<number, string | null>>(() => {
    const base: Record<number, string | null> = { ...(avatars?.userPhotos ?? {}) };
    if (me?.userId && selfPhotoUrl && !base[me.userId]) base[me.userId] = selfPhotoUrl;
    return base;
  }, [avatars, me?.userId, selfPhotoUrl]);

  if (meError || msError || expError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>無法載入</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {describeError(meError ?? msError ?? expError)}
        </CardContent>
      </Card>
    );
  }
  if (!me || !ms || !exp) return <FormSkeleton variant="expense" />;

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
      returnPath={`${platform.basePath}/groups/${groupId}`}
      initial={exp}
    />
  );
}
