"use client";

import { startTransition, use, useMemo, useOptimistic, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  Check,
  HandCoins,
  Loader2,
  NotebookPen,
  Plus,
  Settings,
  User,
} from "lucide-react";

import { Panel } from "@/components/mini/Panel";
import { Avatar, AvatarOverflow } from "@/components/mini/Avatar";
import { ConfirmDialog } from "@/components/mini/ConfirmDialog";
import { DeleteRequestBanner } from "@/components/mini/DeleteRequestBanner";
import { LoadMoreFooter } from "@/components/mini/LoadMoreFooter";
import { RefundIcon } from "@/components/mini/RefundIcon";
import { SoloGroupCard } from "@/components/mini/SoloGroupCard";
import { TimezonePrompt } from "@/components/mini/TimezonePrompt";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { GroupPageSkeleton } from "@/components/mini/skeletons";
import { LoadError } from "@/components/mini/LoadError";
import { SegmentedControl } from "@/components/mini/SegmentedControl";
import { ErrorNote } from "@/components/mini/ErrorNote";
import type { Platform } from "@/components/pages/platform";
import {
  EXPENSE_ONLY_MINE_KEY,
  EXPENSE_VIEW_MODE_KEY,
  expenseUserBalance,
  isRefund,
  isRelatedToUser,
  isSettlement,
  settlementParties,
  type ExpenseViewMode,
} from "@/lib/expense-view";
import { useLocalPref } from "@/lib/use-local-pref";
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
  displayName: string | null;
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

  // Expense-list view preferences, persisted in localStorage. The defaults render until the
  // browser's value is read, so the server and the first client render agree.
  const [storedViewMode, setStoredViewMode] = useLocalPref(EXPENSE_VIEW_MODE_KEY);
  const [storedOnlyMine, setStoredOnlyMine] = useLocalPref(EXPENSE_ONLY_MINE_KEY);
  const viewMode: ExpenseViewMode = storedViewMode === "balance" ? "balance" : "total";
  const onlyMine = storedOnlyMine === "1";
  function toggleOnlyMine() {
    setStoredOnlyMine(onlyMine ? "0" : "1");
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
    setSettleError(null);
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
      setSettleError("沒有記成功，請再試一次。");
    }
    // A saved settlement already invalidated both; this holds the spinner until the new
    // numbers are in, and after a failure puts back the transfer that was optimistically dropped.
    await Promise.all([refetchBalance(), refetchExpenses()]);
    setPendingIdx(null);
  }

  // A failed later page keeps the loaded list and surfaces as the footer's retry button.
  const error = (!expensePages ? expensesError : undefined) ?? balanceError;
  if (error) {
    return <LoadError detail={describeError(error)} />;
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
  const hasOtherMembers =
    !allSettled ||
    (!membersFetching && !!members && members.members.some((m) => m.id !== selfUserId));
  // Until the roster is current we can't tell the two apart; show neither rather than flash
  // the banner and swap it for the card.
  const showSettled = allSettled && !onlyMember && !membersFetching;

  return (
    <div className="space-y-6 py-4">
      {/* Group header — photo + title centered, platform's leading control left, settings icon right */}
      <div className="relative flex items-center justify-center px-4">
        <platform.HeaderLeading />
        <div className="flex min-w-0 items-center gap-2.5">
          {/* The same picture, or initials, as the group's row in the group list. */}
          <Avatar src={avatars?.groupPhoto} name={groupTitle} userId={Number(id)} size="sm" />
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

      <TimezonePrompt groupId={id} />

      {/* Nobody else can record anything in a group of one, so it asks nothing there. */}
      {hasOtherMembers && <platform.GroupPrompt />}

      {onlyMember && (
        <SoloGroupCard groupId={id} basePath={platform.basePath} inviteHint={platform.inviteHint} />
      )}

      {showSettled && (
        <div className="mx-4 rounded-2xl bg-primary/10 px-4 py-3 text-center">
          <p className="text-sm font-medium text-primary">所有帳款已結清</p>
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
            <p className="sect">餘額 · {balance.currency}</p>
            <Link
              href={`${platform.basePath}/groups/${id}/stats`}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <BarChart3 className="size-3" />
              統計
            </Link>
          </div>
          <Panel>
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
          </Panel>
        </section>
      )}

      {optimisticTransfers.length > 0 && (
        <section className="px-4">
          <div className="mb-2.5">
            <p className="sect">待還款</p>
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
                    {pendingIdx === i ? "處理中" : "標記已還"}
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
            紀錄 (
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
          <SegmentedControl
            size="sm"
            label="金額顯示"
            value={viewMode}
            options={[
              { value: "total", label: "總額" },
              { value: "balance", label: "淨額" },
            ]}
            onChange={setStoredViewMode}
          />
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
                  ? "已載入的部分還沒有和你有關的紀錄"
                  : "沒有和你有關的紀錄"
                : onlyMember
                  ? "先加入成員，再記第一筆支出"
                  : "還沒有任何紀錄"}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {Array.from(expensesByMonth.entries()).map(([month, exps]) => (
              <div key={month}>
                <p className="mb-2 text-xs font-medium text-muted-foreground">{month}</p>
                <Panel>
                  {exps.map((e) => {
                    const day = Number(e.spentAt.slice(8, 10));

                    // A refund renders with the person it was paid out to and links to
                    // the refund form (issue #178).
                    if (isRefund(e)) {
                      const to = e.splits[0];
                      const rbal = expenseUserBalance(e, selfUserId);
                      const toLabel = to
                        ? labelUser({ ...to, userId: to.debtorId }, selfUserId)
                        : "?";
                      return (
                        <Link
                          key={e.id}
                          href={`${platform.basePath}/groups/${id}/refunds/${e.id}`}
                          className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/30 active:bg-accent/50"
                        >
                          <Avatar
                            src={getPhoto(to?.debtorId ?? 0)}
                            name={to ? labelUser({ ...to, userId: to.debtorId }) : "?"}
                            userId={to?.debtorId ?? 0}
                            size="sm"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="flex items-center gap-1 text-sm font-medium">
                              <span className="truncate">{e.description || "退稅"}</span>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="inline-flex shrink-0 items-center rounded-lg bg-muted p-1 text-muted-foreground">
                                    <RefundIcon className="size-3" aria-label="退稅" role="img" />
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent>退稅</TooltipContent>
                              </Tooltip>
                              {e.hasNote && <NoteMark />}
                            </p>
                            <p className="truncate text-xs text-muted-foreground">
                              {viewMode === "balance" && rbal.paid > 0
                                ? `你分回 ${fmt(rbal.paid)}`
                                : `${toLabel} 收到`}
                            </p>
                          </div>
                          <div className="shrink-0 text-right">
                            {viewMode === "balance" ? (
                              <p
                                className={`num text-sm font-semibold ${
                                  rbal.net > 0
                                    ? "text-emerald-500"
                                    : rbal.net < 0
                                      ? "text-rose-500"
                                      : "text-muted-foreground"
                                }`}
                              >
                                {rbal.net > 0 ? "+" : ""}
                                {fmt(rbal.net)}{" "}
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
                            {e.hasNote && <NoteMark />}
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
                    // Balance view: spell out 你付 (what you fronted) and 你分 (your share)
                    // so the net on the right reads as 付 − 分. Avatars already show who paid.
                    const payerLine =
                      viewMode !== "balance"
                        ? `${payerLabel} 付`
                        : bal.paid > 0 && bal.owed > 0
                          ? `你付 ${fmt(bal.paid)} · 你分 ${fmt(bal.owed)}`
                          : bal.paid > 0
                            ? `你付 ${fmt(bal.paid)}`
                            : bal.owed > 0
                              ? `你分 ${fmt(bal.owed)}`
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
                            <div className="-ml-2">
                              <AvatarOverflow count={e.payers.length - 2} size="sm" />
                            </div>
                          )}
                          {e.payers.length === 0 && (
                            <Avatar src={null} name="?" userId={0} size="sm" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          {e.description ? (
                            <>
                              <p className="flex items-center gap-1 text-sm font-medium">
                                <span className="truncate">{e.description}</span>
                                {e.hasNote && <NoteMark />}
                              </p>
                              <p className="truncate text-xs text-muted-foreground">{payerLine}</p>
                            </>
                          ) : (
                            <p className="flex items-center gap-1 text-sm font-medium">
                              <span className="truncate">{payerLine}</span>
                              {e.hasNote && <NoteMark />}
                            </p>
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
                </Panel>
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
        <ErrorNote className="mx-4" onDismiss={() => setSettleError(null)}>
          {settleError}
        </ErrorNote>
      )}

      <ConfirmDialog
        open={settleConfirm !== null}
        onOpenChange={(open) => {
          if (!open) setSettleConfirm(null);
        }}
        title={
          settleConfirm
            ? `確認${labelUser(settleConfirm.transfer.from, selfUserId)}已還${labelUser(settleConfirm.transfer.to, selfUserId)}？`
            : ""
        }
        description={
          settleConfirm && balance ? (
            <span>
              會記一筆還款：{labelUser(settleConfirm.transfer.from, selfUserId)} →{" "}
              {labelUser(settleConfirm.transfer.to, selfUserId)}
              <br />
              <span className="num font-semibold text-foreground">
                {fmt(settleConfirm.transfer.amount)} {balance.currency}
              </span>
            </span>
          ) : undefined
        }
        confirmLabel="記一筆還款"
        onConfirm={doSettle}
      />
    </div>
  );
}

/** Marks a list row whose record has a 備註; the note itself is read on the record's page. */
function NoteMark() {
  return (
    <NotebookPen className="size-3 shrink-0 text-muted-foreground" aria-label="有備註" role="img" />
  );
}
