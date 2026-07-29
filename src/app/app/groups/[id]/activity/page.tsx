"use client";

import { use } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ChevronLeft, History } from "lucide-react";
import useSWR from "swr";
import useSWRInfinite from "swr/infinite";

import { ActivityList } from "@/components/mini/ActivityList";
import { ActivitySkeleton } from "@/components/mini/skeletons";
import type { ActivityEntry } from "@/lib/record-history";

type ActivityResponse = { entries: ActivityEntry[]; nextCursor: number | null };
type AvatarsResponse = { userPhotos: Record<number, string | null> };
type MeResponse = { userId: number };

/**
 * The group's change log, or one record's.
 *
 * Both are the same list under a different filter, so they share a page rather
 * than a near-duplicate of one: `?record=<id>` narrows it to a single record's
 * history and drops the day headings, which a handful of rows don't need.
 */
export default function ActivityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const recordId = useSearchParams().get("record");
  const back = recordId ? `/app/groups/${id}` : `/app/groups/${id}/settings`;

  // Infinite rather than a single fetch: the feed is capped per page, so
  // without this everything older than the first page is unreachable. A single
  // record's history is short and always comes back whole (nextCursor null).
  const {
    data: pages,
    error,
    size,
    setSize,
    isValidating,
  } = useSWRInfinite<ActivityResponse>((index, previous) => {
    if (previous && previous.nextCursor == null) return null;
    const cursor = index === 0 ? "" : `cursor=${previous!.nextCursor}`;
    const record = recordId ? `record=${recordId}` : "";
    const query = [record, cursor].filter(Boolean).join("&");
    return `/api/groups/${id}/activity${query ? `?${query}` : ""}`;
  });

  const entries = pages?.flatMap((p) => p.entries) ?? [];
  const hasMore = pages != null && pages[pages.length - 1]?.nextCursor != null;
  const loadingMore = isValidating && pages != null && size > pages.length;
  const { data: avatars } = useSWR<AvatarsResponse>(`/api/groups/${id}/avatars`);
  const { data: me } = useSWR<MeResponse>("/api/me/groups");

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
      <div className="flex items-center gap-2 px-4">
        <Link
          href={back}
          className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
        </Link>
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
          appBase="/app"
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
            onClick={() => setSize(size + 1)}
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
