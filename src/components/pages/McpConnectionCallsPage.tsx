"use client";

import { use, useState } from "react";
import Link from "next/link";
import { ChevronRight, History } from "lucide-react";

import { LoadMoreFooter } from "@/components/mini/LoadMoreFooter";
import { Skeleton } from "@/components/ui/skeleton";
import type { Platform } from "@/components/pages/platform";
import { useLoginRedirect } from "@/components/pages/use-login-redirect";
import { recordHistoryHref } from "@/lib/activity-link";
import { describeError } from "@/lib/api-error";
import {
  CALL_FILTER_LABEL,
  CALL_FILTERS,
  CALL_LOG_DAYS,
  formatDuration,
  linksToRecord,
  outcomeInfo,
  type CallFilter,
} from "@/lib/mcp-call-log";
import { cn } from "@/lib/utils";
import { useAutoLoadMore } from "@/lib/use-auto-load-more";
import { useGetMcpCallsInfiniteQuery, useGetMcpConnectionsQuery, useGetMeQuery } from "@/store/api";

const TONE = {
  ok: "bg-primary/10 text-primary",
  info: "bg-amber-500/15 text-foreground",
  bad: "bg-destructive/10 text-destructive",
} as const;

const DOT = { ok: "bg-primary", info: "bg-amber-500", bad: "bg-destructive" } as const;

function whenLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const time = d.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", hour12: false });
  if (d.toDateString() === now.toDateString()) return time;
  const y = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  if (d.toDateString() === y.toDateString()) return "昨天";
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/**
 * 連結的應用程式 → one connection → 使用紀錄 (issue #153): its recent tool calls and how each
 * ended. Only tool, group, outcome and record are ever stored, never what was said. Shared by
 * `/mini` and `/app`.
 */
export function McpConnectionCallsPage({
  params,
  platform,
}: {
  params: Promise<{ id: string }>;
  platform: Platform;
}) {
  const { id } = use(params);
  const connectionId = Number(id);
  const back = `${platform.basePath}/settings/apps/${connectionId}`;
  platform.useBack(back);

  const [filter, setFilter] = useState<CallFilter>("all");
  const [openId, setOpenId] = useState<number | null>(null);
  const {
    data: result,
    currentData,
    error,
    hasNextPage,
    fetchNextPage,
    refetch,
    isFetching,
  } = useGetMcpCallsInfiniteQuery({ connectionId, filter });
  const { data: me } = useGetMeQuery();
  const { data: connections } = useGetMcpConnectionsQuery();
  const redirectToLogin = useLoginRedirect(error, platform.loginPath);
  const pages = result?.pages;
  const switching = !currentData && !error;
  const calls = pages?.flatMap((p) => p.calls) ?? [];
  const { sentinelRef, loadMore, needsButton } = useAutoLoadMore({
    hasMore: hasNextPage,
    loading: isFetching,
    error,
    loadedPages: pages?.length ?? 0,
    onLoadMore: () => void fetchNextPage(),
  });

  const connection = connections?.connections.find((c) => c.id === connectionId);
  const titles = new Map((me?.groups ?? []).map((g) => [g.id, g.title]));

  if (error && !pages && !redirectToLogin) {
    return (
      <div className="px-4 py-12 text-center">
        <p className="text-sm text-muted-foreground">無法載入</p>
        <p className="mt-1 text-xs text-muted-foreground/60">{describeError(error)}</p>
      </div>
    );
  }

  return (
    <div className="space-y-5 py-4">
      <div className="px-4">
        <platform.BackLink href={back} />
        <h1 className="text-lg font-semibold">使用紀錄</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          {connection ? `「${connection.name}」` : "這個連線"}最近 {CALL_LOG_DAYS}{" "}
          天的工具呼叫與結果。只記錄工具名稱、群組、結果和對應的紀錄，不保存說明文字或收據圖片。
        </p>
      </div>

      <div className="px-4">
        <div
          role="radiogroup"
          aria-label="篩選使用紀錄"
          className="grid grid-cols-3 gap-1 rounded-lg bg-secondary/60 p-1"
        >
          {CALL_FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              role="radio"
              aria-checked={filter === f}
              onClick={() => setFilter(f)}
              className={cn(
                "rounded-md py-1.5 text-sm transition-colors",
                filter === f ? "bg-background font-semibold shadow-sm" : "text-muted-foreground",
              )}
            >
              {CALL_FILTER_LABEL[f]}
            </button>
          ))}
        </div>
      </div>

      {switching ? (
        <div className="space-y-2 px-4" aria-busy="true" aria-label="載入中">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-lg" />
          ))}
        </div>
      ) : calls.length === 0 ? (
        <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-secondary text-muted-foreground">
            <History className="size-6" />
          </span>
          <p className="max-w-[24ch] text-sm text-muted-foreground">
            {filter === "all" ? "還沒有使用紀錄" : "沒有符合的紀錄"}
          </p>
        </div>
      ) : (
        <ul className="mx-4 divide-y divide-border/40 overflow-hidden rounded-2xl bg-secondary/50">
          {calls.map((c) => {
            const info = outcomeInfo(c.outcome);
            const open = openId === c.id;
            const groupTitle = c.groupId != null ? titles.get(c.groupId) : undefined;
            const recordHref =
              c.groupId != null &&
              c.recordId != null &&
              titles.has(c.groupId) &&
              linksToRecord(c.tool, c.outcome)
                ? recordHistoryHref({
                    appBase: platform.basePath,
                    groupId: c.groupId,
                    recordId: c.recordId,
                  })
                : null;
            return (
              <li key={c.id}>
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => setOpenId(open ? null : c.id)}
                  className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/30 active:bg-accent/50"
                >
                  <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", DOT[info.tone])} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="num text-xs font-semibold">{c.tool}</span>
                      <span
                        className={cn(
                          "shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-semibold",
                          TONE[info.tone],
                        )}
                      >
                        {info.label}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {c.groupId == null ? "沒有指定群組" : (groupTitle ?? "其他群組")}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {whenLabel(c.createdAt)}
                  </span>
                </button>
                {open && (
                  <dl className="space-y-0.5 bg-background/40 px-4 py-2.5 pl-9 text-xs text-muted-foreground">
                    <div className="flex justify-between gap-3">
                      <dt>時間</dt>
                      <dd className="num text-foreground">
                        {new Date(c.createdAt).toLocaleString("zh-TW", { hour12: false })}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt>耗時</dt>
                      <dd className="num text-foreground">{formatDuration(c.durationMs)}</dd>
                    </div>
                    {recordHref && (
                      <Link
                        href={recordHref}
                        className="flex items-center justify-between gap-3 pt-1 text-primary"
                      >
                        查看這筆紀錄的變更
                        <ChevronRight className="size-4" />
                      </Link>
                    )}
                  </dl>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {!switching && (hasNextPage || error) && (
        <LoadMoreFooter
          sentinelRef={sentinelRef}
          needsButton={needsButton || !!error}
          loading={isFetching}
          onClick={() => (hasNextPage ? loadMore() : void refetch())}
          className="px-4"
        />
      )}
    </div>
  );
}
