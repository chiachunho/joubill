"use client";

import { use, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import type { EChartsOption } from "echarts";
import useSWR from "swr";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EChart } from "@/components/mini/EChart";
import { useTelegramBackButton } from "@/lib/use-tg-back-button";

type StatsResponse = {
  currency: string;
  monthly: Array<{ month: string; total: number }>;
  byPayer: Array<{ userId: number; firstName: string; username: string | null; total: number }>;
};

function fmt(amount: number) {
  return amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function label(p: { firstName: string; username: string | null }) {
  return p.username ? "@" + p.username : p.firstName;
}

// ECharts writes font-family="sans-serif" on its text nodes by default, which
// the Telegram desktop webview can't resolve to a CJK-capable face. Force a
// stack that has CJK fallback across macOS / Windows / Linux.
const FONT_FAMILY =
  'system-ui, -apple-system, "Segoe UI", "PingFang TC", "PingFang SC", "Microsoft JhengHei", "Noto Sans CJK TC", sans-serif';

/**
 * Read an HSL-component CSS var like "0 0% 100%" and resolve it to a concrete
 * "rgb(r, g, b)" string. ECharts' colour maths (the auto-lighten it does on
 * hover) can't parse the space-separated hsl() syntax our CSS vars use and
 * would render a transparent bar; rgb sidesteps that entirely.
 */
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
          const value = Number(p.value).toFixed(2);
          return `${p.name}<br/>${value} ${stats.currency}`;
        },
      },
      series: [
        {
          type: "bar",
          data: stats.monthly.map((d) => d.total),
          itemStyle: { color: primary, borderRadius: [4, 4, 0, 0] },
          emphasis: { itemStyle: { color: primary, opacity: 0.85 } },
          barWidth: "60%",
        },
      ],
    };
  }, [stats]);

  const payerOption = useMemo<EChartsOption | null>(() => {
    if (!stats || stats.byPayer.length === 0) return null;
    const primary = cssVar("--primary", "#1a73e8");
    const fg = cssVar("--foreground", "#111");
    const border = cssVar("--border", "#e5e5e5");
    const bg = cssVar("--popover", "#fff");
    // Echarts category axis renders bottom-to-top, so reverse to keep top spender on top visually.
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
        data: reversed.map((p) => label(p)),
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
          data: reversed.map((p) => p.total),
          itemStyle: { color: primary, borderRadius: [0, 4, 4, 0] },
          emphasis: { itemStyle: { color: primary, opacity: 0.85 } },
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
  }, [stats]);

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>無法載入</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">{String(error)}</CardContent>
      </Card>
    );
  }
  if (!stats) return <p className="text-muted-foreground">載入中…</p>;

  return (
    <>
      <h1 className="text-xl font-bold">統計（{stats.currency}）</h1>

      <Card>
        <CardHeader>
          <CardTitle>近 6 個月支出</CardTitle>
        </CardHeader>
        <CardContent>
          {stats.monthly.every((m) => m.total === 0) ? (
            <p className="text-sm text-muted-foreground">這段期間沒有支出</p>
          ) : (
            monthlyOption && <EChart option={monthlyOption} height={220} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>誰花得最多</CardTitle>
        </CardHeader>
        <CardContent>
          {stats.byPayer.length === 0 ? (
            <p className="text-sm text-muted-foreground">尚無支出</p>
          ) : (
            <>
              <p className="mb-2 text-xs text-muted-foreground">
                合計：{fmt(stats.byPayer.reduce((s, p) => s + p.total, 0))} {stats.currency}
              </p>
              {payerOption && (
                <EChart option={payerOption} height={Math.max(40 * stats.byPayer.length, 80)} />
              )}
            </>
          )}
        </CardContent>
      </Card>
    </>
  );
}
