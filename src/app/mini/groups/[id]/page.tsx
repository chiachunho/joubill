"use client";

import { startTransition, use, useMemo, useOptimistic } from "react";
import Link from "next/link";
import { BarChart3, Check, Plus } from "lucide-react";
import useSWR from "swr";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { tmaFetch } from "@/lib/tma-fetch";
import { minimizeTransfers } from "@/lib/settlement-core";

type Profile = { firstName: string | null; username: string | null };

type ExpensesResponse = {
  expenses: Array<{
    id: number;
    amount: number;
    currency: string;
    description: string | null;
    spentAt: string;
    payer: { id: number; firstName: string; username: string | null };
    splits: Array<{ debtorId: number; firstName: string; username: string | null; amount: number }>;
  }>;
};

type BalanceResponse = {
  currency: string;
  balances: Array<{
    userId: number;
    amount: number;
    firstName: string | null;
    username: string | null;
  }>;
};

type Transfer = {
  fromUserId: number;
  toUserId: number;
  amount: number;
  from: Profile | null;
  to: Profile | null;
};

function label(p: { username: string | null; firstName: string | null } | null) {
  if (!p) return "?";
  return p.username ? "@" + p.username : (p.firstName ?? "?");
}

function fmt(amount: number) {
  return amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function GroupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const {
    data: expensesData,
    error: expensesError,
    mutate: mutateExpenses,
  } = useSWR<ExpensesResponse>(`/api/groups/${id}/expenses`);

  const {
    data: balance,
    error: balanceError,
    mutate: mutateBalance,
  } = useSWR<BalanceResponse>(`/api/groups/${id}/balance`);

  // Compute transfers client-side from balance data — avoids a third round trip
  // and eliminates the duplicate computeGroupBalances call the /settle route made.
  const computedTransfers = useMemo<Transfer[]>(() => {
    if (!balance) return [];
    const profileMap = new Map(balance.balances.map((b) => [b.userId, b]));
    return minimizeTransfers(balance.balances).map((t) => ({
      ...t,
      from: profileMap.get(t.fromUserId) ?? null,
      to: profileMap.get(t.toUserId) ?? null,
    }));
  }, [balance]);

  // Settling a row drops it from the list instantly; when SWR revalidates and
  // balance updates, useOptimistic resets to the freshly computed transfers.
  const [optimisticTransfers, dropOptimisticTransfer] = useOptimistic(
    computedTransfers,
    (state: Transfer[], removedIdx: number) => state.filter((_, i) => i !== removedIdx),
  );

  async function markSettled(transfer: Transfer, idx: number) {
    if (!balance) return;
    const { default: WebApp } = await import("@twa-dev/sdk");
    WebApp.showPopup(
      {
        title: "確認已轉帳",
        message: `${label(transfer.from)} → ${label(transfer.to)}: ${fmt(transfer.amount)} ${balance.currency}`,
        buttons: [
          { id: "cancel", type: "cancel" },
          { id: "ok", type: "default", text: "已完成" },
        ],
      },
      async (buttonId?: string) => {
        if (buttonId !== "ok") return;
        startTransition(() => dropOptimisticTransfer(idx));
        try {
          await tmaFetch(`/api/groups/${id}/settlements`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              fromUserId: transfer.fromUserId,
              toUserId: transfer.toUserId,
              amount: transfer.amount,
              currency: balance.currency,
            }),
          });
        } catch {
          WebApp.showAlert("標記失敗，已回復");
        }
        await Promise.all([mutateBalance(), mutateExpenses()]);
      },
    );
  }

  const error = expensesError ?? balanceError;
  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>無法載入</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">{String(error)}</CardContent>
      </Card>
    );
  }

  if (!expensesData || !balance) {
    return <p className="text-muted-foreground">載入中…</p>;
  }

  return (
    <>
      <div className="flex justify-end">
        <Button asChild size="sm" variant="ghost">
          <Link href={`/mini/groups/${id}/stats`}>
            <BarChart3 />
            統計
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>目前餘額</CardTitle>
        </CardHeader>
        <CardContent>
          {balance.balances.length === 0 ? (
            <p className="text-sm text-muted-foreground">沒有未結餘額</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {balance.balances.map((b) => (
                <li key={b.userId} className="flex justify-between">
                  <span>{label(b)}</span>
                  <span
                    className={
                      b.amount > 0 ? "text-emerald-600" : b.amount < 0 ? "text-rose-600" : ""
                    }
                  >
                    {b.amount > 0 ? "+" : ""}
                    {fmt(b.amount)} {balance.currency}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>最少還款建議</CardTitle>
        </CardHeader>
        <CardContent>
          {optimisticTransfers.length === 0 ? (
            <p className="text-sm text-muted-foreground">沒有未結算的金額 🎉</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {optimisticTransfers.map((t, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span className="flex-1">
                    {label(t.from)} → {label(t.to)}
                  </span>
                  <span className="tabular-nums">
                    {fmt(t.amount)} {balance.currency}
                  </span>
                  <Button size="sm" variant="outline" onClick={() => markSettled(t, i)}>
                    <Check />
                    已轉
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle>支出明細（{expensesData.expenses.length}）</CardTitle>
          <Button asChild size="sm">
            <Link href={`/mini/groups/${id}/expenses/new`}>
              <Plus />
              新增
            </Link>
          </Button>
        </CardHeader>
        <CardContent>
          {expensesData.expenses.length === 0 ? (
            <p className="text-sm text-muted-foreground">尚無支出</p>
          ) : (
            <ul className="space-y-3 text-sm">
              {expensesData.expenses.map((e) => {
                const date = new Date(e.spentAt).toISOString().slice(5, 10).replace("-", "/");
                return (
                  <li key={e.id} className="border-b pb-2 last:border-0 last:pb-0">
                    <Link
                      href={`/mini/groups/${id}/expenses/${e.id}/edit`}
                      className="block hover:bg-accent/40 -mx-2 px-2 py-1 rounded"
                    >
                      <div className="flex justify-between font-medium">
                        <span>
                          {label(e.payer)} 付 {fmt(e.amount)} {e.currency}
                        </span>
                        <span className="text-muted-foreground">{date}</span>
                      </div>
                      {e.description && (
                        <div className="text-muted-foreground">{e.description}</div>
                      )}
                      <div className="text-xs text-muted-foreground">
                        分給：
                        {e.splits.map((s, i) => (
                          <span key={i}>
                            {i > 0 ? "、" : ""}
                            {label(s)} {fmt(s.amount)}
                          </span>
                        ))}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
