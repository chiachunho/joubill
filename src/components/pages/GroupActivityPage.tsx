"use client";

import { use } from "react";
import { useSearchParams } from "next/navigation";
import { History } from "lucide-react";

import { ActivityList } from "@/components/mini/ActivityList";
import { ActivitySkeleton } from "@/components/mini/skeletons";
import type { Platform } from "@/components/pages/platform";
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
  const recordId = useSearchParams().get("record");

  const backHref = recordId
    ? `${platform.basePath}/groups/${id}`
    : `${platform.basePath}/groups/${id}/settings`;
  platform.useBack(backHref);

  // Paged rather than a single fetch: the feed is capped per page, so without this
  // everything older than the first page is unreachable. A single record's history
  // is short and always comes back whole (nextCursor null).
  const {
    data: result,
    error,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  } = useGetActivityInfiniteQuery({ groupId: id, recordId });
  const pages = result?.pages;

  const entries = pages?.flatMap((p) => p.entries) ?? [];
  const hasMore = hasNextPage;
  const loadingMore = isFetchingNextPage;
  const { data: avatars } = useGetAvatarsQuery(id);
  const { data: me } = useGetMeQuery();

  if (error) {
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

      {entries.length === 0 ? (
        <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-secondary text-muted-foreground">
            <History className="size-6" />
          </span>
          <p className="max-w-[24ch] text-sm text-muted-foreground">
            {recordId ? "這筆記錄還沒有被改動過" : "這個群組還沒有任何改動紀錄"}
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

      {hasMore && (
        <div className="px-4">
          <button
            type="button"
            onClick={() => fetchNextPage()}
            disabled={loadingMore}
            className="w-full rounded-lg bg-secondary px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-secondary/70 disabled:opacity-60"
          >
            {loadingMore ? "載入中…" : "載入更多"}
          </button>
        </div>
      )}
    </div>
  );
}
