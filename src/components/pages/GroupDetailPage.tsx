"use client";

import { startTransition, use, useEffect, useMemo, useOptimistic, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  Check,
  HandCoins,
  Loader2,
  Plus,
  Settings,
  User,
  Users,
} from "lucide-react";

import { Avatar } from "@/components/mini/Avatar";
import { ConfirmDialog } from "@/components/mini/ConfirmDialog";
import { DeleteRequestBanner } from "@/components/mini/DeleteRequestBanner";
import { LoadMoreFooter } from "@/components/mini/LoadMoreFooter";
import { SoloGroupCard } from "@/components/mini/SoloGroupCard";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { GroupPageSkeleton } from "@/components/mini/skeletons";
import type { Platform } from "@/components/pages/platform";
import {
  EXPENSE_ONLY_MINE_KEY,
  EXPENSE_VIEW_MODE_KEY,
  expenseUserBalance,
  isRelatedToUser,
  isSettlement,
  settlementParties,
  type ExpenseViewMode,
} from "@/lib/expense-view";
import { describeError } from "@/lib/api-error";
import { fmt, monthLabel } from "@/lib/format";
import { labelUser } from "@/lib/label";
import { useAutoLoadMore } from "@/lib/use-auto-load-more";
import { minimizeTransfers } from "@/lib/settlement-core";
import {
  useCreateSettlementMutation,
  useGetAvatarsQuery,
  useGetBalanceQuery,
  useGetExpensesInfiniteQuery,
  useGetMeQuery,
  useGetMembersQuery,
} from "@/store/api";

type Profile = {
  userId: number;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
};

type Transfer = {
  fromUserId: number;
  toUserId: number;
  amount: number;
  from: Profile | null;
  to: Profile | null;
};

export function GroupDetailPage({
  params,
  platform,
}: {
  params: Promise<{ id: string }>;
  platform: Platform;
}) {
  const { id } = use(params);

  const { data: me } = useGetMeQuery();
  const selfUserId = me?.userId;
  const groupTitle = me?.groups.find((g) => g.id === Number(id))?.title ?? "";

  const selfPhotoUrl = platform.useSelfPhoto();

  // Paged by cursor; the pages are stitched back into one list below.
  const {
    data: expensesResult,
    error: expensesError,
    refetch: refetchExpenses,
    hasNextPage: hasMoreExpenses,
    fetchNextPage: fetchMoreExpenses,
    isFetching: expensesFetching,
  } = useGetExpensesInfiniteQuery(id);
  const expensePages = expensesResult?.pages;
  const { sentinelRef, loadMore, needsButton } = useAutoLoadMore({
    hasMore: hasMoreExpenses,
    loading: expensesFetching,
    error: expensesError,
    loadedPages: expensePages?.length ?? 0,
    onLoadMore: () => void fetchMoreExpenses(),
  });

  const { data: balance, error: balanceError, refetch: refetchBalance } = useGetBalanceQuery(id);

  // Balances only list people whose net is non-zero, so a group with several members and
  // no balances is rare but possible; a lone member always has none. Only then is the
  // roster worth a request. A failed read just means no card. Always re-read on mount: the
  // card is a claim that nobody else is here, and a cached roster from a few seconds ago
  // may predate someone joining.
  const { data: members, isFetching: membersFetching } = useGetMembersQuery(id, {
    skip: !balance || balance.balances.length > 0,
    refetchOnMountOrArgChange: true,
  });

  const { data: avatars, error: avatarsError } = useGetAvatarsQuery(id);
  if (avatarsError) console.error("[avatars]", avatarsError);

  const [createSettlement] = useCreateSettlementMutation();

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
  const [settleConfirm, setSettleConfirm] = useState<{ transfer: Transfer; idx: number } | null>(
    null,
  );
  const [settleError, setSettleError] = useState<string | null>(null);

  // Expense-list view preferences, persisted in localStorage (shared with the Web App page).
  // Initialise to defaults to avoid a hydration mismatch, then hydrate from storage on mount.
  const [viewMode, setViewMode] = useState<ExpenseViewMode>("total");
  const [onlyMine, setOnlyMine] = useState(false);
  useEffect(() => {
    if (localStorage.getItem(EXPENSE_VIEW_MODE_KEY) === "balance") setViewMode("balance");
    if (localStorage.getItem(EXPENSE_ONLY_MINE_KEY) === "1") setOnlyMine(true);
  }, []);
  function changeViewMode(mode: ExpenseViewMode) {
    setViewMode(mode);
    localStorage.setItem(EXPENSE_VIEW_MODE_KEY, mode);
  }
  function toggleOnlyMine() {
    setOnlyMine((prev) => {
      const next = !prev;
      localStorage.setItem(EXPENSE_ONLY_MINE_KEY, next ? "1" : "0");
      return next;
    });
  }

  function getPhoto(userId: number): string | null {
    const apiPhoto = avatars?.userPhotos[userId] ?? null;
    if (apiPhoto) return apiPhoto;
    // Fall back to TG SDK photo only for the current user when bot API has none
    if (selfUserId !== undefined && userId === selfUserId) return selfPhotoUrl;
    return null;
  }

  function markSettled(transfer: Transfer, idx: number) {
    if (!balance || pendingIdx !== null) return;
    setSettleConfirm({ transfer, idx });
  }

  async function doSettle() {
    if (!settleConfirm || !balance) return;
    const { transfer, idx } = settleConfirm;
    setSettleConfirm(null);
    setPendingIdx(idx);
    startTransition(() => dropOptimisticTransfer(idx));
    try {
      await createSettlement({
        groupId: id,
        body: {
          fromUserId: transfer.fromUserId,
          toUserId: transfer.toUserId,
          amount: transfer.amount,
          currency: balance.currency,
        },
      }).unwrap();
    } catch {
      setSettleError("標記失敗，請再試一次");
    }
    // A saved settlement already invalidated both; this holds the spinner until the new
    // numbers are in, and after a failure puts back the transfer that was optimistically dropped.
    await Promise.all([refetchBalance(), refetchExpenses()]);
    setPendingIdx(null);
  }

  // A failed later page keeps the loaded list and surfaces as the footer's retry button.
  const error = (!expensePages ? expensesError : undefined) ?? balanceError;
  if (error) {
    return (
      <div className="px-4 py-12 text-center">
        <p className="text-sm text-muted-foreground">無法載入</p>
        <p className="mt-1 text-xs text-muted-foreground/60">{describeError(error)}</p>
      </div>
    );
  }

  // Wait for `me` too: balance view and the "only mine" filter depend on selfUserId.
  if (!expensePages || !balance || !me) {
    return <GroupPageSkeleton />;
  }

  // "Only mine" filter, then group by YYYY/MM
  const allExpenses = expensePages.flatMap((p) => p.expenses);
  const visibleExpenses =
    onlyMine && selfUserId !== undefined
      ? allExpenses.filter((e) => isRelatedToUser(e, selfUserId))
      : allExpenses;
  const expensesByMonth = new Map<string, typeof allExpenses>();
  for (const e of visibleExpenses) {
    const m = monthLabel(e.spentAt);
    if (!expensesByMonth.has(m)) expensesByMonth.set(m, []);
    expensesByMonth.get(m)!.push(e);
  }

  const allSettled = balance.balances.length === 0;
  // "All settled" says nothing for a group of one, and the card takes its place.
  const onlyMember =
    allSettled &&
    selfUserId !== undefined &&
    !membersFetching &&
    !!members &&
    // Inactive members are still members (they can be switched back on in 群組設定), so
    // a group whose only others are inactive is not "alone".
    members.members.every((m) => m.id === selfUserId);
  // Until the roster is current we can't tell the two apart; show neither rather than flash
  // the banner and swap it for the card.
  const showSettled = allSettled && !onlyMember && !membersFetching;

  return (
    <div className="space-y-6 py-4">
      {/* Group header — photo + title centered, platform's leading control left, settings icon right */}
      <div className="relative flex items-center justify-center px-4">
        <platform.HeaderLeading />
        <div className="flex min-w-0 items-center gap-2.5">
          {avatars?.groupPhoto ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={avatars.groupPhoto}
              alt={groupTitle}
              className="size-8 shrink-0 rounded-full object-cover ring-1 ring-black/10 dark:ring-white/10"
            />
          ) : (
            <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
              <Users className="size-3.5 text-primary" />
            </div>
          )}
          <h1 className="truncate text-sm font-semibold">{groupTitle}</h1>
        </div>
        <Link
          href={`${platform.basePath}/groups/${id}/settings`}
          className="absolute right-4 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <Settings className="size-4" />
        </Link>
      </div>

      <DeleteRequestBanner groupId={id} selfUserId={selfUserId} redirectPath={platform.basePath} />

      {onlyMember && (
        <SoloGroupCard
          groupId={id}
          basePath={platform.basePath}
          inviteHint={platform.soloInviteHint}
        />
      )}

      {showSettled && (
        <div className="mx-4 rounded-2xl bg-emerald-500/10 px-4 py-3 text-center">
          <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
            所有帳款已結清
          </p>
          <div className="mt-2 flex justify-center gap-4">
            <Link
              href={`${platform.basePath}/groups/${id}/stats`}
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
              href={`${platform.basePath}/groups/${id}/stats`}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <BarChart3 className="size-3" />
              統計
            </Link>
          </div>
          <div className="divide-y divide-border/40 overflow-hidden rounded-2xl bg-secondary/50">
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
          <div className="mb-2.5">
            <p className="sect">To Settle</p>
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
                    <span className="text-xs font-normal text-muted-foreground">
                      {balance.currency}
                    </span>
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
          <p className="sect">
            Expenses (
            {onlyMine
              ? // Filtered client-side over the loaded pages, so the count is a lower bound.
                `${visibleExpenses.length}${hasMoreExpenses ? "+" : ""}`
              : (expensePages[0]?.total ?? visibleExpenses.length)}
            )
          </p>
          <div className="flex items-center gap-1.5">
            <Link
              href={`${platform.basePath}/groups/${id}/settlements/new`}
              className="inline-flex items-center gap-1 rounded-lg bg-secondary px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-secondary/70"
            >
              <Plus className="size-3" />
              還款
            </Link>
            <Link
              href={`${platform.basePath}/groups/${id}/expenses/new`}
              className="inline-flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              <Plus className="size-3" />
              支出
            </Link>
          </div>
        </div>

        {/* View controls: total/balance segmented toggle + "only mine" filter */}
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="inline-flex rounded-lg bg-secondary/50 p-0.5">
            {(
              [
                ["total", "總額"],
                ["balance", "淨額"],
              ] as const
            ).map(([mode, label]) => (
              <button
                key={mode}
                onClick={() => changeViewMode(mode)}
                className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                  viewMode === mode
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {selfUserId !== undefined && (
            <button
              onClick={toggleOnlyMine}
              className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                onlyMine
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground"
              }`}
            >
              <User className="size-3" />
              只看我的
            </button>
          )}
        </div>

        {visibleExpenses.length === 0 ? (
          <div className="rounded-2xl bg-secondary/50 px-4 py-8 text-center">
            <p className="text-sm text-muted-foreground">
              {onlyMine
                ? hasMoreExpenses
                  ? "已載入的紀錄裡還沒有與你相關的支出"
                  : "沒有與你相關的支出"
                : onlyMember
                  ? "先加入成員，再記第一筆支出"
                  : "尚無支出記錄"}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {Array.from(expensesByMonth.entries()).map(([month, exps]) => (
              <div key={month}>
                <p className="mb-2 text-xs font-medium text-muted-foreground">{month}</p>
                <div className="divide-y divide-border/40 overflow-hidden rounded-2xl bg-secondary/50">
                  {exps.map((e) => {
                    const day = new Date(e.spentAt).toISOString().slice(8, 10);

                    // Repayments render as a from → to row and link to the
                    // settlement form instead of the expense form.
                    if (isSettlement(e)) {
                      const { from, to } = settlementParties(e);
                      const sbal = expenseUserBalance(e, selfUserId);
                      return (
                        <Link
                          key={e.id}
                          href={`${platform.basePath}/groups/${id}/settlements/${e.id}`}
                          className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/30 active:bg-accent/50"
                        >
                          <div className="flex min-w-0 flex-1 items-center gap-1.5">
                            <Avatar
                              src={getPhoto(from?.userId ?? 0)}
                              name={labelUser(from)}
                              userId={from?.userId ?? 0}
                              size="sm"
                            />
                            <span className="max-w-[60px] truncate text-sm">
                              {labelUser(from, selfUserId)}
                            </span>
                            <ArrowRight className="size-3 shrink-0 text-muted-foreground/50" />
                            <Avatar
                              src={getPhoto(to?.userId ?? 0)}
                              name={labelUser(to)}
                              userId={to?.userId ?? 0}
                              size="sm"
                            />
                            <span className="max-w-[60px] truncate text-sm">
                              {labelUser(to, selfUserId)}
                            </span>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="inline-flex shrink-0 items-center rounded-lg bg-muted p-1 text-muted-foreground">
                                  <HandCoins className="size-3" />
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>還款</TooltipContent>
                            </Tooltip>
                          </div>
                          <div className="shrink-0 text-right">
                            {viewMode === "balance" ? (
                              <p
                                className={`num text-sm font-semibold ${
                                  sbal.net > 0
                                    ? "text-emerald-500"
                                    : sbal.net < 0
                                      ? "text-rose-500"
                                      : "text-muted-foreground"
                                }`}
                              >
                                {sbal.net > 0 ? "+" : ""}
                                {fmt(sbal.net)}{" "}
                                <span className="text-xs font-normal text-muted-foreground">
                                  {e.currency}
                                </span>
                              </p>
                            ) : (
                              <p className="num text-sm font-semibold">
                                {fmt(e.amount)}{" "}
                                <span className="text-xs font-normal text-muted-foreground">
                                  {e.currency}
                                </span>
                              </p>
                            )}
                            <p className="text-xs text-muted-foreground">{day} 日</p>
                          </div>
                        </Link>
                      );
                    }

                    const payerLabel =
                      e.payers.length === 0
                        ? "?"
                        : e.payers.length === 1
                          ? labelUser(e.payers[0], selfUserId)
                          : e.payers.length === 2
                            ? `${labelUser(e.payers[0], selfUserId)}、${labelUser(e.payers[1], selfUserId)}`
                            : `${labelUser(e.payers[0], selfUserId)} +${e.payers.length - 1}`;
                    const bal = expenseUserBalance(e, selfUserId);
                    // Balance view: spell out 墊付 (what you fronted) and 我分 (your share)
                    // so the net on the right reads as 付 − 分. Avatars already show who paid.
                    const payerLine =
                      viewMode !== "balance"
                        ? `${payerLabel} 付`
                        : bal.paid > 0 && bal.owed > 0
                          ? `墊付 ${fmt(bal.paid)} · 我分 ${fmt(bal.owed)}`
                          : bal.paid > 0
                            ? `墊付 ${fmt(bal.paid)}`
                            : bal.owed > 0
                              ? `我分 ${fmt(bal.owed)}`
                              : `${payerLabel} 付`;
                    return (
                      <Link
                        key={e.id}
                        href={`${platform.basePath}/groups/${id}/expenses/${e.id}/edit`}
                        className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/30 active:bg-accent/50"
                      >
                        {/* Stacked avatars for multiple payers */}
                        <div className="relative flex shrink-0">
                          {e.payers.slice(0, 2).map((p, idx) => (
                            <div key={p.userId} className={idx > 0 ? "-ml-2" : ""}>
                              <Avatar
                                src={getPhoto(p.userId)}
                                name={labelUser(p)}
                                userId={p.userId}
                                size="sm"
                              />
                            </div>
                          ))}
                          {e.payers.length > 2 && (
                            <span className="-ml-2 flex size-7 items-center justify-center rounded-full bg-muted text-[9px] font-semibold text-muted-foreground ring-2 ring-background">
                              +{e.payers.length - 2}
                            </span>
                          )}
                          {e.payers.length === 0 && (
                            <Avatar src={null} name="?" userId={0} size="sm" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          {e.description ? (
                            <>
                              <p className="truncate text-sm font-medium">{e.description}</p>
                              <p className="truncate text-xs text-muted-foreground">{payerLine}</p>
                            </>
                          ) : (
                            <p className="truncate text-sm font-medium">{payerLine}</p>
                          )}
                        </div>
                        <div className="shrink-0 text-right">
                          {viewMode === "balance" ? (
                            <p
                              className={`num text-sm font-semibold ${
                                bal.net > 0
                                  ? "text-emerald-500"
                                  : bal.net < 0
                                    ? "text-rose-500"
                                    : "text-muted-foreground"
                              }`}
                            >
                              {bal.net > 0 ? "+" : ""}
                              {fmt(bal.net)}{" "}
                              <span className="text-xs font-normal text-muted-foreground">
                                {e.currency}
                              </span>
                            </p>
                          ) : (
                            <p className="num text-sm font-semibold">
                              {fmt(e.amount)}{" "}
                              <span className="text-xs font-normal text-muted-foreground">
                                {e.currency}
                              </span>
                            </p>
                          )}
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

        {/* Also on a failed refresh of a fully loaded list, so the stale rows come with a retry. */}
        {(hasMoreExpenses || expensesError) && (
          <LoadMoreFooter
            sentinelRef={sentinelRef}
            needsButton={needsButton || !!expensesError}
            loading={expensesFetching}
            onClick={() => (hasMoreExpenses ? loadMore() : void refetchExpenses())}
            className="mt-4"
          />
        )}
      </section>

      {settleError && (
        <div className="mx-4 rounded-lg bg-destructive/10 px-4 py-2.5 text-sm text-destructive">
          {settleError}
        </div>
      )}

      <ConfirmDialog
        open={settleConfirm !== null}
        onOpenChange={(open) => {
          if (!open) setSettleConfirm(null);
        }}
        title="確認已轉帳"
        description={
          settleConfirm && balance ? (
            <span>
              {labelUser(settleConfirm.transfer.from, selfUserId)} →{" "}
              {labelUser(settleConfirm.transfer.to, selfUserId)}
              <br />
              <span className="num font-semibold text-foreground">
                {fmt(settleConfirm.transfer.amount)} {balance.currency}
              </span>
            </span>
          ) : undefined
        }
        confirmLabel="已完成"
        onConfirm={doSettle}
      />
    </div>
  );
}
