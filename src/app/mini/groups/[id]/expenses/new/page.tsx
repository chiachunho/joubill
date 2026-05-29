"use client";

import { use } from "react";
import useSWR from "swr";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ExpenseForm } from "@/components/mini/ExpenseForm";

type Member = { id: number; firstName: string; username: string | null };

type MeResponse = {
  userId: number;
  groups: Array<{ id: number; defaultCurrency: string }>;
};

type MembersResponse = { members: Member[] };

export default function NewExpensePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const groupId = Number(id);

  const { data: me, error: meError } = useSWR<MeResponse>("/api/me/groups");
  const { data: ms, error: msError } = useSWR<MembersResponse>(`/api/groups/${groupId}/members`);

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
  if (!me || !ms) return <p className="text-muted-foreground">載入中…</p>;

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
    />
  );
}
