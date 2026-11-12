"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, KeyRound, Plus, Users } from "lucide-react";

import { Avatar } from "@/components/mini/Avatar";
import { GroupsListSkeleton } from "@/components/mini/skeletons";
import type { Platform } from "@/components/pages/platform";
import { useLoginRedirect } from "@/components/pages/use-login-redirect";
import { describeError } from "@/lib/api-error";
import { expenseEditPath } from "@/lib/record-path";
import { useGetGroupPhotosQuery, useGetMeQuery } from "@/store/api";

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
  },
  basePath: string,
): string | null {
  if (!data.activeGroupId) return null;
  const group = `${basePath}/groups/${data.activeGroupId}`;
  if (data.activeExpenseId)
    return expenseEditPath(basePath, data.activeGroupId, data.activeExpenseId);
  if (data.activeSettlementId) return `${group}/settlements/${data.activeSettlementId}`;
  return group;
}

export function GroupsHome({ platform }: { platform: Platform }) {
  const router = useRouter();
  const { data, error } = useGetMeQuery();
  const { data: photosData } = useGetGroupPhotosQuery();

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
      router.replace(`${platform.basePath}/join/${data.activeInviteCode}`);
      return;
    }
    const target = data && deepLinkTarget(data, platform.basePath);
    if (!target || handledDeepLinks.has(target)) return;
    handledDeepLinks.add(target);
    router.replace(target);
  }, [data, router, platform.basePath]);

  const redirectToLogin = useLoginRedirect(error, platform.loginPath);

  if (error && !redirectToLogin) {
    return (
      <div className="px-4 py-12 text-center">
        <p className="text-sm text-muted-foreground">無法載入群組</p>
        <p className="mt-1 text-xs text-muted-foreground/60">{describeError(error)}</p>
      </div>
    );
  }

  if (!data) return <GroupsListSkeleton />;

  // Blank only while a redirect is about to happen; once the invite was handled the list shows.
  const invitePending = !!data.activeInviteCode && !handledInvites.has(data.activeInviteCode);
  const target = deepLinkTarget(data, platform.basePath);
  const deepLinkPending = !!target && !handledDeepLinks.has(target);
  if (deepLinkPending || invitePending) return null;

  const { groups } = data;

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
        <div className="px-4 py-20 text-center">
          <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-secondary">
            <Users className="size-6 text-muted-foreground" />
          </div>
          <p className="font-semibold">還沒有任何群組</p>
          <p className="mt-1 text-sm text-muted-foreground">
            在這裡建立群組，或輸入邀請碼加入；也可以把機器人加進 Telegram 群組，輸入 /start
          </p>
        </div>
      ) : (
        <div className="mx-4 divide-y divide-border/50 overflow-hidden rounded-2xl bg-secondary/50">
          {groups.map((g) => (
            <Link
              key={g.id}
              href={`${platform.basePath}/groups/${g.id}`}
              className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-accent/40 active:bg-accent/60"
            >
              {photosData?.photos[g.id] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={photosData.photos[g.id]!}
                  alt={g.title}
                  className="size-9 shrink-0 rounded-full object-cover ring-1 ring-black/10 dark:ring-white/10"
                />
              ) : (
                // No photo (a web group has no chat, a Telegram group may not have set one).
                <Avatar name={g.title} userId={g.id} />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{g.title}</p>
                <p className="text-xs text-muted-foreground">{g.defaultCurrency}</p>
              </div>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground/40" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
