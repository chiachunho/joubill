"use client";

import { use } from "react";
import useSWR from "swr";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ExpenseForm } from "@/components/mini/ExpenseForm";
import { FormSkeleton } from "@/components/mini/skeletons";

type Member = { id: number; firstName: string; lastName: string | null; username: string | null };
type MeResponse = { userId: number; groups: Array<{ id: number; defaultCurrency: string }> };
type MembersResponse = { members: Member[] };
type AvatarsResponse = { userPhotos: Record<number, string | null> };
type ExpenseDetail = {
  id: number; createdBy: number | null;
  createdAt: string | null;
  lastActivity: { actorId: number | null; at: string } | null;
  amount: number; currency: string; fxRate: number | null; fxQuote: string | null;
  description: string | null;
  payers: Array<{ payerId: number; amount: number }>; spentAt: string; receiptFileIds?: string[];
  splits: Array<{ debtorId: number; amount: number; shareType: string }>;
};

export default function AppEditExpensePage({
  params,
}: {
  params: Promise<{ id: string; expenseId: string }>;
}) {
  const { id, expenseId } = use(params);
  const groupId = Number(id);
  const eid = Number(expenseId);

  const { data: me, error: meError } = useSWR<MeResponse>("/api/me/groups");
  const { data: ms, error: msError } = useSWR<MembersResponse>(`/api/groups/${groupId}/members`);
  const { data: exp, error: expError } = useSWR<ExpenseDetail>(`/api/groups/${groupId}/expenses/${eid}`);
  const { data: avatars } = useSWR<AvatarsResponse>(`/api/groups/${groupId}/avatars`);

  if (meError ?? msError ?? expError) {
    return (
      <Card><CardHeader><CardTitle>無法載入</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {String(meError ?? msError ?? expError)}
        </CardContent>
      </Card>
    );
  }
  if (!me || !ms || !exp) return <FormSkeleton variant="expense" />;

  const group = me.groups.find((g) => g.id === groupId);
  if (!group) {
    return (
      <Card><CardHeader><CardTitle>無法載入</CardTitle></CardHeader>
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
      photos={avatars?.userPhotos}
      initial={exp}
      returnPath={`/app/groups/${groupId}`}
    />
  );
}
