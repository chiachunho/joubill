"use client";

import { use } from "react";
import useSWR from "swr";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ExpenseForm } from "@/components/mini/ExpenseForm";

type Member = { id: number; firstName: string; username: string | null };

type ExpenseDetail = {
  id: number;
  amount: number;
  currency: string;
  description: string | null;
  payerId: number;
  spentAt: string;
  splits: Array<{ debtorId: number; amount: number; shareType: string }>;
};

type MeResponse = {
  userId: number;
  groups: Array<{ id: number; defaultCurrency: string }>;
};

type MembersResponse = { members: Member[] };

export default function EditExpensePage({
  params,
}: {
  params: Promise<{ id: string; expenseId: string }>;
}) {
  const { id, expenseId } = use(params);
  const groupId = Number(id);
  const eid = Number(expenseId);

  const { data: me, error: meError } = useSWR<MeResponse>("/api/me/groups");
  const { data: ms, error: msError } = useSWR<MembersResponse>(`/api/groups/${groupId}/members`);
  const { data: exp, error: expError } = useSWR<ExpenseDetail>(
    `/api/groups/${groupId}/expenses/${eid}`,
  );

  if (meError || msError || expError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>無法載入</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {String(meError ?? msError ?? expError)}
        </CardContent>
      </Card>
    );
  }
  if (!me || !ms || !exp) return <p className="text-muted-foreground">載入中…</p>;

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
      initial={exp}
    />
  );
}
