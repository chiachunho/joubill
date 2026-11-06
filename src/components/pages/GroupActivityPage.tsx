"use client";

import { use, useState } from "react";
import { useSearchParams } from "next/navigation";
import { History } from "lucide-react";

import { ActivityList } from "@/components/mini/ActivityList";
import { LoadMoreFooter } from "@/components/mini/LoadMoreFooter";
import { ActivitySkeleton } from "@/components/mini/skeletons";
import { Skeleton } from "@/components/ui/skeleton";
import type { Platform } from "@/components/pages/platform";
import { parseHistoryFrom } from "@/lib/activity-link";
import {
  ACTIVITY_SOURCE_LABEL,
  ACTIVITY_SOURCES,
  type ActivitySource,
} from "@/lib/activity-source";
import { cn } from "@/lib/utils";
import { useAutoLoadMore } from "@/lib/use-auto-load-more";
import { useGetActivityInfiniteQuery, useGetAvatarsQuery, useGetMeQuery } from "@/store/api";

/**
 * The group's change log, or one record's.
 *
 * Both are the same list under a different filter, so they share a page rather
 * than a near-duplicate of one: `?record=<id>` narrows it to a single record's
 * history and drops the day headings, which a handful of rows don't need.
 */
export function GroupActivityPage({
  params,
  platform,
}: {
  params: Promise<{ id: string }>;
  platform: Platform;
}) {
  const { id } = use(params);
  const searchParams = useSearchParams();
  const recordId = searchParams.get("record");
  const [source, setSource] = useState<ActivitySource>("all");

  // A record's history is reached from its edit form or from the feed, and 返回
  // goes back to whichever it was (`from`, validated to a page inside this
  // group). Opened directly, or with a `from` that doesn't check out, it falls
  // back to the group home.
  const from = parseHistoryFrom(searchParams.get("from"), {
    appBase: platform.basePath,
    groupId: id,
  });
  const backHref = recordId
    ? (from ?? `${platform.basePath}/groups/${id}`)
    : `${platform.basePath}/groups/${id}/settings`;
  platform.useBack(backHref);

  // Paged rather than a single fetch: the feed is capped per page, so without this
  // everything older than the first page is unreachable. A single record's history
  // is short and always comes back whole (nextCursor null).
  const {
    data: result,
    currentData,
    error,
    hasNextPage,
    fetchNextPage,
    refetch,
    isFetching,
  } = useGetActivityInfiniteQuery({ groupId: id, recordId, source: recordId ? "all" : source });
  const pages = result?.pages;
  // `data` keeps the previous filter's pages while a new one loads; the list must not show
  // them (or the empty message) under a filter they were not fetched for.
  const switching = !currentData && !error;

  const entries = pages?.flatMap((p) => p.entries) ?? [];
  const hasMore = hasNextPage;
  const { sentinelRef, loadMore, needsButton } = useAutoLoadMore({
    hasMore,
    loading: isFetching,
    error,
    loadedPages: pages?.length ?? 0,
    onLoadMore: () => void fetchNextPage(),
  });
  const { data: avatars } = useGetAvatarsQuery(id);
  const { data: me } = useGetMeQuery();

  // A failed later page keeps the loaded feed; the footer offers the retry.
  if (error && !pages) {
    return (
      <div className="flex flex-col items-center gap-2 px-4 py-16 text-center">
        <p className="text-sm text-muted-foreground">讀不到動態紀錄</p>
        <p className="text-xs text-muted-foreground/60">請稍後再試</p>
      </div>
    );
  }

  if (!pages) return <ActivitySkeleton />;

  return (
    <div className="space-y-6 py-4">
      <div className="px-4">
        <platform.BackLink href={backHref} />
        <h1 className="text-lg font-semibold">{recordId ? "變更紀錄" : "動態紀錄"}</h1>
      </div>

      {!recordId && (
        <div className="px-4">
          <div
            role="radiogroup"
            aria-label="篩選動態"
            className="grid grid-cols-3 gap-1 rounded-lg bg-secondary/60 p-1"
          >
            {ACTIVITY_SOURCES.map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={source === s}
                onClick={() => setSource(s)}
                className={cn(
                  "rounded-md py-1.5 text-sm transition-colors",
                  source === s ? "bg-background font-semibold shadow-sm" : "text-muted-foreground",
                )}
              >
                {ACTIVITY_SOURCE_LABEL[s]}
              </button>
            ))}
          </div>
        </div>
      )}

      {switching ? (
        <div className="space-y-2 px-4" aria-busy="true">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-lg" />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-secondary text-muted-foreground">
            <History className="size-6" />
          </span>
          <p className="max-w-[24ch] text-sm text-muted-foreground">
            {recordId
              ? "這筆記錄還沒有被改動過"
              : source === "all"
                ? "這個群組還沒有任何改動紀錄"
                : "沒有符合的動態"}
          </p>
        </div>
      ) : (
        <ActivityList
          entries={entries}
          photos={avatars?.userPhotos}
          currentUserId={me?.userId}
          appBase={platform.basePath}
          groupId={id}
          showRecordLabel={!recordId}
          groupByDay={!recordId}
          linkRows={!recordId}
        />
      )}

      {!switching && (hasMore || error) && (
        <LoadMoreFooter
          sentinelRef={sentinelRef}
          needsButton={needsButton || !!error}
          loading={isFetching}
          onClick={() => (hasMore ? loadMore() : void refetch())}
          className="px-4"
        />
      )}
    </div>
  );
}
