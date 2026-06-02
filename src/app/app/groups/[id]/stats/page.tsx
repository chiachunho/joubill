"use client";

import { use, useMemo } from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import type { EChartsOption } from "echarts";
import useSWR from "swr";

import { EChart } from "@/components/mini/EChart";
import { StatsSkeleton } from "@/components/mini/skeletons";
import { fmt } from "@/lib/format";
import { labelUser } from "@/lib/label";

type StatsResponse = {
  currency: string;
  monthly: Array<{ month: string; total: number }>;
  byPayer: Array<{ userId: number; firstName: string; lastName: string | null; username: string | null; total: number }>;
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

export default function AppStatsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: stats, error } = useSWR<StatsResponse>(`/api/groups/${id}/stats`);

  const monthlyOption = useMemo<EChartsOption | null>(() => {
    if (!stats) return null;
    const primary = cssVar("--primary", "#1a73e8");
    const fg = cssVar("--foreground", "#111");
    const muted = cssVar("--muted-foreground", "#999");
    const border = cssVar("--border", "#e5e5e5");
    const bg = cssVar("--popover", "#fff");
    return {
      textStyle: { fontFamily: FONT_FAMILY },
      grid: { top: 20, right: 10, bottom: 30, left: 44 },
      xAxis: {
        type: "category",
        data: stats.monthly.map((d) => `${d.month.slice(5)}/${d.month.slice(2, 4)}`),
        axisLine: { lineStyle: { color: border } },
        axisTick: { show: false },
        axisLabel: { color: muted, fontSize: 11 },
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
          const p = Array.isArray(params) ? params[0] : params;
          return `${p.name}<br/>${Number(p.value).toFixed(2)} ${stats.currency}`;
        },
      },
      series: [{
        type: "bar",
        data: stats.monthly.map((d) => d.total),
        itemStyle: { color: primary, borderRadius: [4, 4, 0, 0] },
        emphasis: { itemStyle: { color: primary, opacity: 0.85 } },
        barWidth: "60%",
      }],
    };
  }, [stats]);

  const payerOption = useMemo<EChartsOption | null>(() => {
    if (!stats || stats.byPayer.length === 0) return null;
    const primary = cssVar("--primary", "#1a73e8");
    const fg = cssVar("--foreground", "#111");
    const border = cssVar("--border", "#e5e5e5");
    const bg = cssVar("--popover", "#fff");
    const reversed = [...stats.byPayer].reverse();
    return {
      textStyle: { fontFamily: FONT_FAMILY },
      grid: { top: 8, right: 60, bottom: 16, left: 96 },
      xAxis: { type: "value", splitLine: { show: false }, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { show: false } },
      yAxis: { type: "category", data: reversed.map((p) => labelUser(p)), axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: fg, fontSize: 12 } },
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
      series: [{
        type: "bar",
        data: reversed.map((p) => p.total),
        itemStyle: { color: primary, borderRadius: [0, 4, 4, 0] },
        emphasis: { itemStyle: { color: primary, opacity: 0.85 } },
        barWidth: "60%",
        label: { show: true, position: "right", color: fg, fontSize: 11, formatter: (p) => Number(p.value).toFixed(2) },
      }],
    };
  }, [stats]);

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

  return (
    <div className="space-y-6 py-4">
      <div className="px-4">
        <Link
          href={`/app/groups/${id}`}
          className="inline-flex items-center gap-0.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
          返回
        </Link>
        <h1 className="mt-1 text-lg font-semibold">統計</h1>
        <p className="mt-0.5 text-xs text-muted-foreground">{stats.currency}</p>
      </div>

      <section className="px-4">
        <p className="sect mb-2.5">近 6 個月支出</p>
        <div className="overflow-hidden rounded-2xl bg-secondary/50 px-4 py-4">
          {stats.monthly.every((m) => m.total === 0) ? (
            <p className="py-4 text-center text-sm text-muted-foreground">這段期間沒有支出</p>
          ) : (
            monthlyOption && <EChart option={monthlyOption} height={220} />
          )}
        </div>
      </section>

      <section className="px-4">
        <p className="sect mb-2.5">誰花得最多</p>
        <div className="overflow-hidden rounded-2xl bg-secondary/50 px-4 py-4">
          {stats.byPayer.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">尚無支出</p>
          ) : (
            <>
              <p className="mb-3 text-xs text-muted-foreground">
                歷史合計{" "}
                <span className="num font-semibold text-foreground">{fmt(grandTotal)}</span>{" "}
                {stats.currency}
              </p>
              {payerOption && <EChart option={payerOption} height={Math.max(40 * stats.byPayer.length, 80)} />}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
