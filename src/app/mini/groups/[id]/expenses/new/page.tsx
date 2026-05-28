"use client";

import { use, useEffect, useState } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ExpenseForm } from "@/components/mini/ExpenseForm";
import { tmaFetch } from "@/lib/tma-fetch";

type Member = { id: number; firstName: string; username: string | null };

type Bundle = {
  userId: number;
  defaultCurrency: string;
  members: Member[];
};

export default function NewExpensePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const groupId = Number(id);
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      tmaFetch<{
        userId: number;
        groups: Array<{ id: number; defaultCurrency: string }>;
      }>("/api/me/groups"),
      tmaFetch<{ members: Member[] }>(`/api/groups/${groupId}/members`),
    ])
      .then(([me, ms]) => {
        const group = me.groups.find((g) => g.id === groupId);
        if (!group) {
          setError("你不屬於這個群組");
          return;
        }
        setBundle({
          userId: me.userId,
          defaultCurrency: group.defaultCurrency,
          members: ms.members,
        });
      })
      .catch((err: Error) => setError(err.message));
  }, [groupId]);

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>無法載入</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">{error}</CardContent>
      </Card>
    );
  }
  if (!bundle) return <p className="text-muted-foreground">載入中…</p>;

  return (
    <ExpenseForm
      groupId={groupId}
      currentUserId={bundle.userId}
      defaultCurrency={bundle.defaultCurrency}
      members={bundle.members}
    />
  );
}
