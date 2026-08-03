"use client";

import { use, useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { EChartsOption } from "echarts";
import useSWR from "swr";

import {
  DateRangeSelect,
  RANGE_LABELS,
  type StatsRangeValue,
} from "@/components/mini/DateRangeSelect";
import { EChart } from "@/components/mini/EChart";
import { MemberSelect } from "@/components/mini/MemberSelect";
import { StatsSkeleton } from "@/components/mini/skeletons";
import { fmt } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { labelUser } from "@/lib/label";
import { useTelegramBackButton } from "@/lib/use-tg-back-button";

// Tailwind's emerald-500 / rose-500 — the two design-system-sanctioned
// financial-polarity colors (see docs/design-system.md). ECharts can't
// consume Tailwind classes, so these mirror them as literal hex.
const EMERALD = "#10b981";
const ROSE = "#f43f5e";

type MeResponse = {
  userId: number;
  groups: Array<{ id: number; title: string; defaultCurrency: string }>;
};

type MembersResponse = {
  members: Array<{
    id: number;
    firstName: string | null;
    lastName: string | null;
    username: string | null;
    status: string;
  }>;
};

type AvatarsResponse = { groupPhoto: string | null; userPhotos: Record<number, string | null> };

type StatsResponse = {
  currency: string;
  selectedUserId: number;
  range: { key: string; from: string; to: string };
  monthly: Array<{ month: string; groupTotal: number; memberShare: number }>;
  netTrend: Array<{ date: string; net: number }>;
  byPayer: Array<{
    userId: number;
    firstName: string;
    lastName: string | null;
    username: string | null;
    total: number;
  }>;
};

const FONT_FAMILY =
  'system-ui, -apple-system, "Segoe UI", "PingFang TC", "PingFang SC", "Microsoft JhengHei", "Noto Sans CJK TC", sans-serif';

function cssVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (!v) return fallback;
  const probe = document.createElement("span");
  probe.style.color = `hsl(${v})`;
  document.body.appendChild(probe);
  const rgb = getComputedStyle(probe).color;
  document.body.removeChild(probe);
  return rgb || fallback;
}

export default function StatsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const back = useCallback(() => router.push(`/mini/groups/${id}`), [router, id]);
  useTelegramBackButton(back);

  const { data: me } = useSWR<MeResponse>("/api/me/groups");
  const selfUserId = me?.userId;
  const { data: membersData } = useSWR<MembersResponse>(`/api/groups/${id}/members`);
  const { data: avatars } = useSWR<AvatarsResponse>(`/api/groups/${id}/avatars`);

  const [selectedUserId, setSelectedUserId] = useState<number | undefined>(undefined);
  const [range, setRange] = useState<StatsRangeValue>({ key: "6m" });

  const statsKey = useMemo(() => {
    if (range.key === "custom" && (!range.from || !range.to)) return null;
    const qs = new URLSearchParams();
    if (selectedUserId !== undefined) qs.set("userId", String(selectedUserId));
    qs.set("range", range.key);
    if (range.key === "custom") {
      qs.set("from", range.from!);
      qs.set("to", range.to!);
    }
    return `/api/groups/${id}/stats?${qs.toString()}`;
  }, [id, selectedUserId, range]);

  const { data: stats, error } = useSWR<StatsResponse>(statsKey);

  const viewedUserId = selectedUserId ?? stats?.selectedUserId;
  const viewedMember = membersData?.members.find((m) => m.id === viewedUserId);
  // `viewedMember` comes from /members (shaped `{id, ...}`), but labelUser's
  // "you" check compares `userId` — map the id field across or "你" never matches.
  const viewedLabel = viewedMember
    ? labelUser(
        {
          userId: viewedMember.id,
          firstName: viewedMember.firstName,
          lastName: viewedMember.lastName,
          username: viewedMember.username,
        },
        selfUserId,
      )
    : undefined;
  const rangeLabel = RANGE_LABELS[range.key] ?? range.key;

  const netTrendOption = useMemo<EChartsOption | null>(() => {
    if (!stats || stats.netTrend.length === 0) return null;
    const fg = cssVar("--foreground", "#111");
    const muted = cssVar("--muted-foreground", "#999");
    const border = cssVar("--border", "#e5e5e5");
    const bg = cssVar("--popover", "#fff");
    const data = stats.netTrend.map((p) => [new Date(p.date).getTime(), p.net]);
    return {
      textStyle: { fontFamily: FONT_FAMILY },
      grid: { top: 16, right: 12, bottom: 26, left: 48 },
      xAxis: {
        type: "time",
        axisLine: { lineStyle: { color: border } },
        axisTick: { show: false },
        axisLabel: { color: muted, fontSize: 11 },
      },
      yAxis: {
        type: "value",
        splitLine: { lineStyle: { color: border, type: "dashed" } },
        axisLabel: { color: muted, fontSize: 11 },
      },
      visualMap: {
        show: false,
        dimension: 1,
        pieces: [
          { min: 0, color: EMERALD },
          { max: 0, color: ROSE },
        ],
      },
      tooltip: {
        trigger: "axis",
        backgroundColor: bg,
        borderColor: border,
        textStyle: { color: fg, fontSize: 12 },
        formatter: (params) => {
          const p = Array.isArray(params) ? params[0] : params;
          const [ts, value] = p.value as [number, number];
          const d = new Date(ts);
          return `${d.getMonth() + 1}/${d.getDate()}<br/>${formatMoney(value, stats.currency)}`;
        },
      },
      series: [
        {
          type: "line",
          data,
          symbol: "circle",
          symbolSize: 6,
          lineStyle: { width: 2 },
          areaStyle: { opacity: 0.16 },
          markLine: {
            silent: true,
            symbol: "none",
            lineStyle: { type: "dashed", color: border, width: 1 },
            label: { show: false },
            data: [{ yAxis: 0 }],
          },
        },
      ],
    };
  }, [stats]);

  const monthlyOption = useMemo<EChartsOption | null>(() => {
    if (!stats) return null;
    const primary = cssVar("--primary", "#1a73e8");
    const muted = cssVar("--muted-foreground", "#999");
    const border = cssVar("--border", "#e5e5e5");
    const fg = cssVar("--foreground", "#111");
    const bg = cssVar("--popover", "#fff");
    const dense = stats.monthly.length > 8;
    return {
      textStyle: { fontFamily: FONT_FAMILY },
      grid: { top: 20, right: 10, bottom: dense ? 44 : 30, left: 48 },
      xAxis: {
        type: "category",
        data: stats.monthly.map((d) => `${d.month.slice(5)}/${d.month.slice(2, 4)}`),
        axisLine: { lineStyle: { color: border } },
        axisTick: { show: false },
        axisLabel: { color: muted, fontSize: 11, rotate: dense ? 45 : 0 },
      },
      yAxis: {
        type: "value",
        splitLine: { lineStyle: { color: border, type: "dashed" } },
        axisLabel: { color: muted, fontSize: 11 },
      },
      tooltip: {
        trigger: "axis",
        backgroundColor: bg,
        borderColor: border,
        textStyle: { color: fg, fontSize: 12 },
        formatter: (params) => {
          const arr = Array.isArray(params) ? params : [params];
          const name = arr[0]?.name ?? "";
          const lines = arr.map(
            (p) => `${p.marker} ${p.seriesName}: ${fmt(Number(p.value))} ${stats.currency}`,
          );
          return [name, ...lines].join("<br/>");
        },
      },
      series: [
        {
          name: "群組總支出",
          type: "bar",
          data: stats.monthly.map((d) => d.groupTotal),
          itemStyle: { color: `${muted}`, opacity: 0.35, borderRadius: [4, 4, 0, 0] },
          barWidth: "60%",
        },
        {
          name: viewedLabel ? `${viewedLabel}的分攤` : "分攤",
          type: "line",
          data: stats.monthly.map((d) => d.memberShare),
          itemStyle: { color: primary },
          lineStyle: { width: 2, color: primary },
          symbol: "circle",
          symbolSize: 6,
        },
      ],
    };
  }, [stats, viewedLabel]);

  const payerOption = useMemo<EChartsOption | null>(() => {
    if (!stats || stats.byPayer.length === 0) return null;
    const primary = cssVar("--primary", "#1a73e8");
    const muted = cssVar("--muted-foreground", "#999");
    const fg = cssVar("--foreground", "#111");
    const border = cssVar("--border", "#e5e5e5");
    const bg = cssVar("--popover", "#fff");
    const reversed = [...stats.byPayer].reverse();
    return {
      textStyle: { fontFamily: FONT_FAMILY },
      grid: { top: 8, right: 60, bottom: 16, left: 96 },
      xAxis: {
        type: "value",
        splitLine: { show: false },
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { show: false },
      },
      yAxis: {
        type: "category",
        data: reversed.map((p) => labelUser(p, selfUserId)),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: fg, fontSize: 12 },
      },
      tooltip: {
        trigger: "axis",
        backgroundColor: bg,
        borderColor: border,
        textStyle: { color: fg, fontSize: 12 },
        formatter: (params) => {
          const p = Array.isArray(params) ? params[0] : params;
          return `${p.name}: ${Number(p.value).toFixed(2)} ${stats.currency}`;
        },
      },
      series: [
        {
          type: "bar",
          data: reversed.map((p) => ({
            value: p.total,
            itemStyle: {
              color: p.userId === viewedUserId ? primary : `${muted}`,
              opacity: p.userId === viewedUserId ? 1 : 0.4,
            },
          })),
          barWidth: "60%",
          label: {
            show: true,
            position: "right",
            color: fg,
            fontSize: 11,
            formatter: (p) => Number(p.value).toFixed(2),
          },
        },
      ],
    };
  }, [stats, selfUserId, viewedUserId]);

  if (error) {
    return (
      <div className="px-4 py-12 text-center">
        <p className="text-sm text-muted-foreground">無法載入</p>
        <p className="mt-1 text-xs text-muted-foreground/60">{String(error)}</p>
      </div>
    );
  }

  if (!stats) return <StatsSkeleton />;

  const grandTotal = stats.byPayer.reduce((s, p) => s + p.total, 0);
  const latestNet = stats.netTrend.at(-1)?.net ?? 0;

  return (
    <div className="space-y-6 py-4">
      <div className="px-4">
        <h1 className="text-lg font-semibold">統計</h1>
        <p className="mt-0.5 text-xs text-muted-foreground">{stats.currency}</p>
      </div>

      {/* View-as + range controls */}
      <section className="px-4">
        <div className="grid grid-cols-2 gap-2.5">
          <div>
            <p className="sect mb-2.5">查看視角</p>
            <MemberSelect
              value={String(viewedUserId ?? "")}
              onValueChange={(v) => setSelectedUserId(Number(v))}
              members={membersData?.members ?? []}
              photos={avatars?.userPhotos}
            />
          </div>
          <div>
            <p className="sect mb-2.5">區間</p>
            <DateRangeSelect value={range} onChange={setRange} />
          </div>
        </div>
      </section>

      {/* Net trend — the primary chart */}
      <section className="px-4">
        <p className="sect mb-2.5">淨額歷史趨勢</p>
        <div className="overflow-hidden rounded-2xl bg-secondary/50 px-4 py-4">
          {stats.netTrend.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">尚無資料</p>
          ) : (
            <>
              <p
                className={`num text-2xl font-bold ${latestNet >= 0 ? "text-emerald-500" : "text-rose-500"}`}
              >
                {formatMoney(latestNet, stats.currency)}
              </p>
              {netTrendOption && <EChart option={netTrendOption} height={200} />}
            </>
          )}
        </div>
      </section>

      {/* Monthly spend, with the viewed member's share overlaid */}
      <section className="px-4">
        <div className="mb-2.5 flex items-center gap-1.5">
          <p className="sect">近期支出</p>
          <span className="text-[0.64rem] text-muted-foreground/80">· {rangeLabel}</span>
        </div>
        <div className="overflow-hidden rounded-2xl bg-secondary/50 px-4 py-4">
          {stats.monthly.every((m) => m.groupTotal === 0) ? (
            <p className="py-4 text-center text-sm text-muted-foreground">這段期間沒有支出</p>
          ) : (
            <>
              <div className="mb-3 flex gap-3.5">
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="size-1.5 rounded-full bg-muted-foreground/50" />
                  群組總支出
                </span>
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="size-1.5 rounded-full bg-primary" />
                  {viewedLabel ? `${viewedLabel}的分攤` : "分攤"}
                </span>
              </div>
              {monthlyOption && <EChart option={monthlyOption} height={220} />}
            </>
          )}
        </div>
      </section>

      {/* By payer — kept as a secondary block, now scoped to the same range */}
      <section className="px-4">
        <div className="mb-2.5 flex items-center gap-1.5 opacity-80">
          <p className="sect">誰花得最多</p>
          <span className="text-[0.64rem] text-muted-foreground/80">· {rangeLabel}</span>
        </div>
        <div className="overflow-hidden rounded-2xl bg-secondary/30 px-4 py-4">
          {stats.byPayer.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">這段期間沒有支出</p>
          ) : (
            <>
              <p className="mb-3 text-xs text-muted-foreground">
                {rangeLabel}合計{" "}
                <span className="num font-semibold text-foreground">{fmt(grandTotal)}</span>{" "}
                {stats.currency}
              </p>
              {payerOption && (
                <EChart option={payerOption} height={Math.max(40 * stats.byPayer.length, 80)} />
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
