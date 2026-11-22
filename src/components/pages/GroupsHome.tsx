"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, KeyRound, Plus, Users } from "lucide-react";

import { EmptyState } from "@/components/mini/EmptyState";
import { Panel } from "@/components/mini/Panel";
import { Avatar } from "@/components/mini/Avatar";
import { GroupsListSkeleton } from "@/components/mini/skeletons";
import { LoadError } from "@/components/mini/LoadError";
import { SegmentedControl } from "@/components/mini/SegmentedControl";
import { Skeleton } from "@/components/ui/skeleton";
import type { Platform } from "@/components/pages/platform";
import { useLoginRedirect } from "@/components/pages/use-login-redirect";
import { describeError } from "@/lib/api-error";
import {
  GROUP_SORT_KEY,
  GROUP_SORTS,
  STANDING_LABEL,
  parseGroupSort,
  sortGroups,
  standingOf,
  updatedLabel,
} from "@/lib/group-list";
import { fmtGrouped } from "@/lib/money";
import { expenseEditPath } from "@/lib/record-path";
import { useLocalPref } from "@/lib/use-local-pref";
import { useGetGroupPhotosQuery, useGetMeQuery, useGetMyBalancesQuery } from "@/store/api";

/**
 * Join links already acted on. The start param lives as long as the webview, so without this every
 * visit to the home page would bounce back to the invite — including 回首頁 from an invalid one.
 */
const handledInvites = new Set<string>();

/**
 * Group deep links already acted on, for the same reason: the group header's 我的群組 link leads
 * here, and a second redirect would send the viewer straight back into the group (or the record).
 */
const handledDeepLinks = new Set<string>();

/** Where a `startapp=group_…` deep link leads, or null when there is none. */
function deepLinkTarget(
  data: {
    activeGroupId?: number | null;
    activeExpenseId?: number | null;
    activeSettlementId?: number | null;
    activeRefundId?: number | null;
  },
  basePath: string,
): string | null {
  if (!data.activeGroupId) return null;
  const group = `${basePath}/groups/${data.activeGroupId}`;
  if (data.activeExpenseId)
    return expenseEditPath(basePath, data.activeGroupId, data.activeExpenseId);
  if (data.activeSettlementId) return `${group}/settlements/${data.activeSettlementId}`;
  if (data.activeRefundId) return `${group}/refunds/${data.activeRefundId}`;
  return group;
}

export function GroupsHome({ platform }: { platform: Platform }) {
  const router = useRouter();
  const { data, error } = useGetMeQuery();
  const { data: photosData } = useGetGroupPhotosQuery();

  // A deep link (Mini App only) leaves this page at once, so nothing on it is ever seen.
  // Known only once `data` is in, which is why the Mini App asks for balances after the list
  // rather than alongside it; the web, which never redirects, asks for both at once.
  // What this mount itself redirected to. The module-level sets are updated in the effect, so a
  // re-render before the navigation lands would otherwise read as "already handled" and start
  // the request after all.
  const [sentFromHere] = useState(() => new Set<string>());
  const pending = (key: string | null | undefined, handled: Set<string>) =>
    !!key && (!handled.has(key) || sentFromHere.has(key));
  const invitePending = pending(data?.activeInviteCode, handledInvites);
  const target = data ? deepLinkTarget(data, platform.basePath) : null;
  const deepLinkPending = pending(target, handledDeepLinks);
  const redirecting = deepLinkPending || invitePending;
  // Fills in after the list: each group's balance converts every record in it.
  const { data: balancesData, isError: balancesFailed } = useGetMyBalancesQuery(undefined, {
    skip: platform.deepLinks && (!data || redirecting),
  });
  const [storedSort, setStoredSort] = useLocalPref(GROUP_SORT_KEY);
  const sort = parseGroupSort(storedSort);

  // A Telegram deep link (startapp) names a group, and maybe an expense or settlement in it.
  // Only the Mini App gets one: the endpoint leaves activeGroupId null on the web.
  useEffect(() => {
    // A join link names an invite, not a group: the preview decides what happens next.
    if (
      data?.activeInviteCode &&
      !data.activeGroupId &&
      !handledInvites.has(data.activeInviteCode)
    ) {
      handledInvites.add(data.activeInviteCode);
      sentFromHere.add(data.activeInviteCode);
      router.replace(`${platform.basePath}/join/${data.activeInviteCode}`);
      return;
    }
    const target = data && deepLinkTarget(data, platform.basePath);
    if (!target || handledDeepLinks.has(target)) return;
    handledDeepLinks.add(target);
    sentFromHere.add(target);
    router.replace(target);
  }, [data, router, platform.basePath, sentFromHere]);

  const redirectToLogin = useLoginRedirect(error, platform.loginPath);

  if (error && !redirectToLogin) {
    return <LoadError title="無法載入群組" detail={describeError(error)} />;
  }

  if (!data) return <GroupsListSkeleton />;

  // Blank only while a redirect is about to happen; once the invite was handled the list shows.
  if (redirecting) return null;

  const groups = sortGroups(data.groups, sort);

  return (
    <div className="py-6">
      <platform.HomeHeader />

      <div className="mx-4 mb-3 grid grid-cols-2 gap-2">
        <Link
          href={`${platform.basePath}/groups/new`}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2.5 text-sm font-medium text-primary-foreground transition-opacity active:opacity-80"
        >
          <Plus className="size-4" />
          建立群組
        </Link>
        <Link
          href={`${platform.basePath}/groups/join`}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-secondary px-3 py-2.5 text-sm font-medium transition-colors hover:bg-accent/40 active:bg-accent/60"
        >
          <KeyRound className="size-4" />
          輸入邀請碼
        </Link>
      </div>

      {groups.length === 0 ? (
        <EmptyState icon={Users} title="還沒有任何群組">
          在這裡建立群組，或輸入邀請碼加入；也可以把機器人加進 Telegram 群組，輸入 /start
        </EmptyState>
      ) : (
        <>
          <div className="mx-4 mb-2 flex items-center justify-between gap-3 pl-1">
            <p className="sect">{groups.length} 個群組</p>
            <SegmentedControl
              size="sm"
              label="排序方式"
              value={sort}
              options={GROUP_SORTS}
              onChange={setStoredSort}
            />
          </div>
          <Panel className="mx-4">
            {groups.map((g) => (
              <Link
                key={g.id}
                href={`${platform.basePath}/groups/${g.id}`}
                className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-accent/40 active:bg-accent/60"
              >
                {/* No photo: a web group has no chat, a Telegram group may not have set one. */}
                <Avatar src={photosData?.photos[g.id]} name={g.title} userId={g.id} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{g.title}</p>
                  <p className="text-xs text-muted-foreground">{updatedLabel(g.lastActivityAt)}</p>
                </div>
                <GroupBalance
                  balance={balancesData?.balances[g.id]}
                  loading={!balancesData && !balancesFailed}
                />
                <ChevronRight className="size-4 shrink-0 text-muted-foreground/40" />
              </Link>
            ))}
          </Panel>
        </>
      )}
    </div>
  );
}

/**
 * The viewer's balance in one group, worded like the bot's private `/balance`: 應收 / 應付 over
 * the amount in the group's currency, or 已結清. Nothing when it could not be loaded.
 */
function GroupBalance({
  balance,
  loading,
}: {
  balance: { amount: number; currency: string } | undefined;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="flex shrink-0 flex-col items-end gap-1.5" aria-hidden>
        <Skeleton className="h-2.5 w-6" />
        <Skeleton className="h-3.5 w-16" />
      </div>
    );
  }
  if (!balance) return null;
  const standing = standingOf(balance.amount);
  if (standing === "settled") {
    return <span className="shrink-0 text-xs text-muted-foreground">{STANDING_LABEL.settled}</span>;
  }
  const tone = standing === "receive" ? "text-emerald-500" : "text-rose-500";
  return (
    <div className={`flex shrink-0 flex-col items-end ${tone}`}>
      <span className="text-xs leading-tight">{STANDING_LABEL[standing]}</span>
      <span className="num text-sm font-semibold leading-tight">
        {fmtGrouped(Math.abs(balance.amount))}{" "}
        <span className="text-xs font-normal">{balance.currency}</span>
      </span>
    </div>
  );
}
