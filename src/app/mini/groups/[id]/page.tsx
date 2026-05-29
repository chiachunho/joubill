"use client";

import { startTransition, use, useEffect, useMemo, useOptimistic, useState } from "react";
import Link from "next/link";
import { ArrowRight, BarChart3, Check, History, Loader2, Plus, Users } from "lucide-react";
import useSWR from "swr";

import { Avatar } from "@/components/mini/Avatar";
import { GroupPageSkeleton } from "@/components/mini/skeletons";
import { labelUser } from "@/lib/label";
import { tmaFetch } from "@/lib/tma-fetch";
import { minimizeTransfers } from "@/lib/settlement-core";

type MeResponse = {
  userId: number;
  groups: Array<{ id: number; title: string; defaultCurrency: string }>;
};

type Profile = {
  userId: number;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
};

type ExpensesResponse = {
  expenses: Array<{
    id: number;
    amount: number;
    currency: string;
    description: string | null;
    spentAt: string;
    payer: { userId: number; firstName: string; lastName: string | null; username: string | null };
    splits: Array<{
      debtorId: number;
      firstName: string;
      lastName: string | null;
      username: string | null;
      amount: number;
    }>;
  }>;
};

type BalanceResponse = {
  currency: string;
  balances: Array<{
    userId: number;
    amount: number;
    firstName: string | null;
    lastName: string | null;
    username: string | null;
  }>;
};

type AvatarsResponse = {
  groupPhoto: string | null;
  userPhotos: Record<number, string | null>;
};

type Transfer = {
  fromUserId: number;
  toUserId: number;
  amount: number;
  from: Profile | null;
  to: Profile | null;
};

function fmt(amount: number) {
  return amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function monthLabel(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default function GroupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const { data: me } = useSWR<MeResponse>("/api/me/groups");
  const selfUserId = me?.userId;
  const groupTitle = me?.groups.find((g) => g.id === Number(id))?.title ?? "";

  const [selfPhotoUrl, setSelfPhotoUrl] = useState<string | null>(null);
  useEffect(() => {
    import("@twa-dev/sdk").then(({ default: WebApp }) => {
      setSelfPhotoUrl(WebApp.initDataUnsafe.user?.photo_url ?? null);
    });
  }, []);

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

  const { data: avatars, error: avatarsError } = useSWR<AvatarsResponse>(`/api/groups/${id}/avatars`);
  if (avatarsError) console.error("[avatars]", avatarsError);

  const computedTransfers = useMemo<Transfer[]>(() => {
    if (!balance) return [];
    const profileMap = new Map(balance.balances.map((b) => [b.userId, b]));
    return minimizeTransfers(balance.balances).map((t) => ({
      ...t,
      from: profileMap.get(t.fromUserId) ?? null,
      to: profileMap.get(t.toUserId) ?? null,
    }));
  }, [balance]);

  const [optimisticTransfers, dropOptimisticTransfer] = useOptimistic(
    computedTransfers,
    (state: Transfer[], removedIdx: number) => state.filter((_, i) => i !== removedIdx),
  );

  const [pendingIdx, setPendingIdx] = useState<number | null>(null);

  function getPhoto(userId: number): string | null {
    if (selfUserId !== undefined && userId === selfUserId && selfPhotoUrl) return selfPhotoUrl;
    return avatars?.userPhotos[userId] ?? null;
  }

  async function markSettled(transfer: Transfer, idx: number) {
    if (!balance || pendingIdx !== null) return;
    setPendingIdx(idx);
    try {
      const { default: WebApp } = await import("@twa-dev/sdk");
      WebApp.showPopup(
        {
          title: "確認已轉帳",
          message: `${labelUser(transfer.from, selfUserId)} → ${labelUser(transfer.to, selfUserId)}: ${fmt(transfer.amount)} ${balance.currency}`,
          buttons: [
            { id: "cancel", type: "cancel" },
            { id: "ok", type: "default", text: "已完成" },
          ],
        },
        async (buttonId?: string) => {
          if (buttonId !== "ok") {
            setPendingIdx(null);
            return;
          }
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
          setPendingIdx(null);
        },
      );
    } catch {
      setPendingIdx(null);
    }
  }

  const error = expensesError ?? balanceError;
  if (error) {
    return (
      <div className="px-4 py-12 text-center">
        <p className="text-sm text-muted-foreground">無法載入</p>
        <p className="mt-1 text-xs text-muted-foreground/60">{String(error)}</p>
      </div>
    );
  }

  if (!expensesData || !balance) {
    return <GroupPageSkeleton />;
  }

  // Group expenses by YYYY/MM
  const expensesByMonth = new Map<string, typeof expensesData.expenses>();
  for (const e of expensesData.expenses) {
    const m = monthLabel(e.spentAt);
    if (!expensesByMonth.has(m)) expensesByMonth.set(m, []);
    expensesByMonth.get(m)!.push(e);
  }

  const allSettled = balance.balances.length === 0;

  return (
    <div className="space-y-6 py-4">
      {/* Group header — photo left, title centered, invisible spacer mirrors photo width */}
      <div className="flex items-center px-4">
        {avatars?.groupPhoto ? (
          <img
            src={avatars.groupPhoto}
            alt={groupTitle}
            className="size-12 shrink-0 rounded-full object-cover ring-1 ring-black/10 dark:ring-white/10"
          />
        ) : (
          <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary/10">
            <Users className="size-5 text-primary" />
          </div>
        )}
        <h1 className="min-w-0 flex-1 truncate px-3 text-center text-lg font-semibold">{groupTitle}</h1>
        <div className="size-12 shrink-0" aria-hidden />
      </div>

      {allSettled && (
        <div className="mx-4 rounded-2xl bg-emerald-500/10 px-4 py-3 text-center">
          <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">所有帳款已結清</p>
          <div className="mt-2 flex justify-center gap-4">
            <Link
              href={`/mini/groups/${id}/settlements`}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              <History className="size-3" />
              還款記錄
            </Link>
            <Link
              href={`/mini/groups/${id}/stats`}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              <BarChart3 className="size-3" />
              統計
            </Link>
          </div>
        </div>
      )}

      {!allSettled && (
        <section className="px-4">
          <div className="mb-2.5 flex items-center justify-between">
            <p className="sect">Balance · {balance.currency}</p>
            <Link
              href={`/mini/groups/${id}/stats`}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <BarChart3 className="size-3" />
              統計
            </Link>
          </div>
          <div className="overflow-hidden rounded-2xl bg-secondary/50 divide-y divide-border/40">
            {balance.balances.map((b) => (
              <div key={b.userId} className="flex items-center gap-3 px-4 py-3">
                <Avatar src={getPhoto(b.userId)} name={labelUser(b)} userId={b.userId} size="sm" />
                <span className="flex-1 text-sm">{labelUser(b, selfUserId)}</span>
                <span
                  className={`num text-sm font-semibold ${
                    b.amount > 0
                      ? "text-emerald-500"
                      : b.amount < 0
                        ? "text-rose-500"
                        : "text-muted-foreground"
                  }`}
                >
                  {b.amount > 0 ? "+" : ""}
                  {fmt(b.amount)}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {optimisticTransfers.length > 0 && (
        <section className="px-4">
          <div className="mb-2.5 flex items-center justify-between">
            <p className="sect">To Settle</p>
            <Link
              href={`/mini/groups/${id}/settlements`}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <History className="size-3" />
              還款記錄
            </Link>
          </div>
          <div className="space-y-2">
            {optimisticTransfers.map((t, i) => (
              <div key={i} className="rounded-2xl bg-secondary/50 px-4 py-3">
                <div className="flex items-center gap-2">
                  <Avatar
                    src={getPhoto(t.fromUserId)}
                    name={labelUser(t.from)}
                    userId={t.fromUserId}
                    size="sm"
                  />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {labelUser(t.from, selfUserId)}
                  </span>
                  <ArrowRight className="size-3.5 shrink-0 text-muted-foreground/60" />
                  <span className="min-w-0 flex-1 truncate text-right text-sm font-medium">
                    {labelUser(t.to, selfUserId)}
                  </span>
                  <Avatar
                    src={getPhoto(t.toUserId)}
                    name={labelUser(t.to)}
                    userId={t.toUserId}
                    size="sm"
                  />
                </div>
                <div className="mt-2.5 flex items-center justify-between">
                  <p className="num text-base font-semibold">
                    {fmt(t.amount)}{" "}
                    <span className="text-xs font-normal text-muted-foreground">{balance.currency}</span>
                  </p>
                  <button
                    disabled={pendingIdx === i}
                    onClick={() => markSettled(t, i)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-primary/10 px-3 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/20 disabled:opacity-50"
                  >
                    {pendingIdx === i ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <Check className="size-3" />
                    )}
                    {pendingIdx === i ? "處理中" : "已轉"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Expenses */}
      <section className="px-4">
        <div className="mb-2.5 flex items-center justify-between">
          <p className="sect">Expenses ({expensesData.expenses.length})</p>
          <Link
            href={`/mini/groups/${id}/expenses/new`}
            className="inline-flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            <Plus className="size-3" />
            新增
          </Link>
        </div>

        {expensesData.expenses.length === 0 ? (
          <div className="rounded-2xl bg-secondary/50 px-4 py-8 text-center">
            <p className="text-sm text-muted-foreground">尚無支出記錄</p>
          </div>
        ) : (
          <div className="space-y-4">
            {Array.from(expensesByMonth.entries()).map(([month, exps]) => (
              <div key={month}>
                <p className="mb-2 text-xs font-medium text-muted-foreground">{month}</p>
                <div className="overflow-hidden rounded-2xl bg-secondary/50 divide-y divide-border/40">
                  {exps.map((e) => {
                    const day = new Date(e.spentAt).toISOString().slice(8, 10);
                    return (
                      <Link
                        key={e.id}
                        href={`/mini/groups/${id}/expenses/${e.id}/edit`}
                        className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/30 active:bg-accent/50"
                      >
                        <Avatar
                          src={getPhoto(e.payer.userId)}
                          name={labelUser(e.payer)}
                          userId={e.payer.userId}
                          size="sm"
                        />
                        <div className="min-w-0 flex-1">
                          {e.description ? (
                            <>
                              <p className="truncate text-sm font-medium">{e.description}</p>
                              <p className="truncate text-xs text-muted-foreground">
                                {labelUser(e.payer, selfUserId)} 付
                              </p>
                            </>
                          ) : (
                            <p className="text-sm font-medium">{labelUser(e.payer, selfUserId)} 付</p>
                          )}
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="num text-sm font-semibold">
                            {fmt(e.amount)}{" "}
                            <span className="text-xs font-normal text-muted-foreground">{e.currency}</span>
                          </p>
                          <p className="text-xs text-muted-foreground">{day} 日</p>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
