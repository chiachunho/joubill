"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { tmaFetch } from "@/lib/tma-fetch";

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

type SettleResponse = {
  currency: string;
  transfers: Array<{
    fromUserId: number;
    toUserId: number;
    amount: number;
    from: Profile | null;
    to: Profile | null;
  }>;
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
  const [expenses, setExpenses] = useState<ExpensesResponse | null>(null);
  const [balance, setBalance] = useState<BalanceResponse | null>(null);
  const [settle, setSettle] = useState<SettleResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    try {
      const [e, b, s] = await Promise.all([
        tmaFetch<ExpensesResponse>(`/api/groups/${id}/expenses`),
        tmaFetch<BalanceResponse>(`/api/groups/${id}/balance`),
        tmaFetch<SettleResponse>(`/api/groups/${id}/settle`),
      ]);
      setExpenses(e);
      setBalance(b);
      setSettle(s);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [id]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  const [settlingIdx, setSettlingIdx] = useState<number | null>(null);
  async function markSettled(transfer: SettleResponse["transfers"][number], idx: number) {
    if (!settle) return;
    const { default: WebApp } = await import("@twa-dev/sdk");
    WebApp.showPopup(
      {
        title: "確認已轉帳",
        message: `${label(transfer.from)} → ${label(transfer.to)}: ${fmt(transfer.amount)} ${settle.currency}`,
        buttons: [
          { id: "cancel", type: "cancel" },
          { id: "ok", type: "default", text: "已完成" },
        ],
      },
      async (buttonId?: string) => {
        if (buttonId !== "ok") return;
        setSettlingIdx(idx);
        const res = await fetch(`/api/groups/${id}/settlements`, {
          method: "POST",
          headers: {
            Authorization: `tma ${WebApp.initData}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            fromUserId: transfer.fromUserId,
            toUserId: transfer.toUserId,
            amount: transfer.amount,
            currency: settle.currency,
          }),
        });
        setSettlingIdx(null);
        if (!res.ok) {
          WebApp.showAlert("標記失敗");
          return;
        }
        await refetch();
      },
    );
  }

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

  if (!expenses || !balance || !settle) {
    return <p className="text-muted-foreground">載入中…</p>;
  }

  return (
    <>
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
          {settle.transfers.length === 0 ? (
            <p className="text-sm text-muted-foreground">沒有未結算的金額 🎉</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {settle.transfers.map((t, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span className="flex-1">
                    {label(t.from)} → {label(t.to)}
                  </span>
                  <span className="tabular-nums">
                    {fmt(t.amount)} {settle.currency}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => markSettled(t, i)}
                    disabled={settlingIdx !== null}
                  >
                    {settlingIdx === i ? "…" : "✓ 已轉"}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle>支出明細（{expenses.expenses.length}）</CardTitle>
          <Button asChild size="sm">
            <Link href={`/mini/groups/${id}/expenses/new`}>+ 新增</Link>
          </Button>
        </CardHeader>
        <CardContent>
          {expenses.expenses.length === 0 ? (
            <p className="text-sm text-muted-foreground">尚無支出</p>
          ) : (
            <ul className="space-y-3 text-sm">
              {expenses.expenses.map((e) => {
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
