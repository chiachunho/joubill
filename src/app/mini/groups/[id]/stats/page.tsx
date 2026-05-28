"use client";

import { use, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { tmaFetch } from "@/lib/tma-fetch";
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

/** Vertical SVG bar chart for the 6-month monthly totals. */
function MonthlyBars({ data, currency }: { data: StatsResponse["monthly"]; currency: string }) {
  const max = Math.max(...data.map((d) => d.total), 1);
  const W = 320;
  const H = 140;
  const padBottom = 24;
  const barW = W / data.length;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img">
      {data.map((d, i) => {
        const ratio = d.total / max;
        const h = ratio * (H - padBottom - 4);
        const x = i * barW;
        const y = H - padBottom - h;
        return (
          <g key={d.month}>
            <title>{`${d.month} · ${fmt(d.total)} ${currency}`}</title>
            <rect
              x={x + 4}
              y={y}
              width={barW - 8}
              height={Math.max(h, 1)}
              rx={2}
              className="fill-primary"
            />
            <text
              x={x + barW / 2}
              y={H - 10}
              textAnchor="middle"
              className="fill-muted-foreground text-[10px]"
            >
              {d.month.slice(5)}/{d.month.slice(2, 4)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export default function StatsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const back = useCallback(() => router.push(`/mini/groups/${id}`), [router, id]);
  useTelegramBackButton(back);

  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    tmaFetch<StatsResponse>(`/api/groups/${id}/stats`)
      .then(setStats)
      .catch((err: Error) => setError(err.message));
  }, [id]);

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>無法載入</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">{error}</CardContent>
      </Card>
    );
  }
  if (!stats) return <p className="text-muted-foreground">載入中…</p>;

  const max = Math.max(...stats.byPayer.map((p) => p.total), 1);

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
            <MonthlyBars data={stats.monthly} currency={stats.currency} />
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
            <ul className="space-y-2 text-sm">
              {stats.byPayer.map((p) => (
                <li key={p.userId}>
                  <div className="mb-1 flex justify-between">
                    <span>{label(p)}</span>
                    <span className="tabular-nums">
                      {fmt(p.total)} {stats.currency}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${(p.total / max) * 100}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
