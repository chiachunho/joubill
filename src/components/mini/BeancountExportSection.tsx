"use client";

import { useState } from "react";
import { useDispatch } from "react-redux";
import { skipToken } from "@reduxjs/toolkit/query";
import { Check, Download, Send } from "lucide-react";

import { DateRangePicker } from "@/components/mini/DateRangeSelect";
import { BeancountExportSkeleton } from "@/components/mini/skeletons";
import type { Platform } from "@/components/pages/platform";
import { apiErrorText } from "@/lib/api-error";
import { beancountRangeParams } from "@/lib/beancount-range";
import { saveResponseAsFile } from "@/lib/download";
import { customRangeToQuery } from "@/lib/stats-core";
import {
  api,
  useGetBeancountExportSummaryQuery,
  useSendBeancountExportMutation,
} from "@/store/api";

type Choice = "new" | "all" | "custom";

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString("zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/**
 * Export the viewer's personal beancount ledger for the group: pick a range, then
 * download it (Web App) or have the bot send it to their private chat (both apps).
 * 上次匯出後 picks up where the last 全部 / 上次匯出後 export stopped; the server
 * keeps that watermark per (user, group) and moves it only when a file is handed over.
 */
export function BeancountExportSection({
  groupId,
  platform,
}: {
  groupId: string;
  platform: Pick<Platform, "canDownloadExport" | "rawRequest">;
}) {
  // Unset until the viewer picks: then 上次匯出後 when there is a last export, else 全部.
  // Before the first answer the query asks for `new`, which with no watermark is everything.
  const [picked, setPicked] = useState<Choice | null>(null);
  const [from, setFrom] = useState<string>();
  const [to, setTo] = useState<string>();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pending, setPending] = useState<"download" | "send" | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [sendExport] = useSendBeancountExportMutation();
  const dispatch = useDispatch();

  const [lastExportedAt, setLastExportedAt] = useState<string | null | undefined>(undefined);
  const choice: Choice = picked ?? (lastExportedAt ? "new" : "all");

  let params: Record<string, string> | null;
  if (choice === "custom") {
    const bounds = customRangeToQuery({ key: "custom", from, to });
    params =
      bounds.from && bounds.to
        ? beancountRangeParams({ kind: "custom", from: bounds.from, to: bounds.to })
        : null;
  } else {
    params = beancountRangeParams({ kind: picked === null ? "new" : choice });
  }

  const { currentData: summary, error } = useGetBeancountExportSummaryQuery(
    params ? { groupId, params } : skipToken,
  );
  // The watermark is the same in every answer; remember it so the 上次匯出後 row
  // doesn't disappear while a custom range is being picked.
  if (summary && summary.lastExportedAt !== lastExportedAt) {
    setLastExportedAt(summary.lastExportedAt);
  }

  if (error && lastExportedAt === undefined) {
    return (
      <section className="px-4">
        <div className="rounded-2xl bg-secondary/50 px-4 py-3 text-sm text-muted-foreground">
          無法載入
        </div>
      </section>
    );
  }
  if (lastExportedAt === undefined) return <BeancountExportSkeleton />;

  const count = summary ? summary.included : null;
  const corrected = summary?.corrected ?? 0;
  const empty = count === 0 && corrected === 0;
  const busy = pending !== null;
  const ready = !!params && !!summary && !empty && !busy;

  function pick(next: Choice) {
    setPicked(next);
    setMessage(null);
    if (next === "custom" && !(from && to)) setPickerOpen(true);
  }

  async function download() {
    if (!ready || !params) return;
    setPending("download");
    setMessage(null);
    try {
      const qs = new URLSearchParams(params).toString();
      const res = await platform.rawRequest(`/api/groups/${groupId}/beancount/export?${qs}`);
      if (!res.ok) {
        setMessage({ ok: false, text: "匯出失敗，請再試一次" });
        return;
      }
      await saveResponseAsFile(res, "export.beancount");
      // The watermark moved: every cached range's summary is stale, not just this one's
      // (a stale one would put the old 上次匯出 time back on screen when picked).
      dispatch(api.util.invalidateTags([{ type: "BeancountExport", id: String(groupId) }]));
    } catch {
      setMessage({ ok: false, text: "匯出失敗，請再試一次" });
    } finally {
      setPending(null);
    }
  }

  async function send() {
    if (!ready || !params) return;
    setPending("send");
    setMessage(null);
    try {
      const { included, corrected } = await sendExport({ groupId, params }).unwrap();
      const fixes = corrected > 0 ? `、修正 ${corrected} 筆` : "";
      setMessage({ ok: true, text: `已傳 ${included} 筆${fixes}到你和機器人的私訊` });
    } catch (e) {
      setMessage({ ok: false, text: apiErrorText(e, "傳送失敗，請再試一次") });
    } finally {
      setPending(null);
    }
  }

  const countText = (c: Choice) => {
    if (choice !== c) return null;
    if (c === "custom" && !params) return "選擇日期範圍";
    if (count === null) return error ? "無法計算筆數" : "計算中…";
    if (empty) return c === "new" ? "沒有新的變動" : "沒有跟你有關的紀錄";
    // Only 上次匯出後 has corrections to tell apart from the new records.
    return c === "new" ? `新增 ${count} 筆，修正 ${corrected} 筆` : `${count} 筆`;
  };

  const options: { key: Choice; label: string; hint: string | null }[] = [
    ...(lastExportedAt
      ? [
          {
            key: "new" as const,
            label: "上次匯出後的變動",
            hint: `上次：${formatWhen(lastExportedAt)}`,
          },
        ]
      : []),
    { key: "all", label: "全部", hint: null },
    { key: "custom", label: "自訂日期範圍", hint: "依消費日期，不會更新上次匯出的位置" },
  ];

  const rowClass =
    "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/30 active:bg-accent/50 disabled:opacity-50";

  return (
    <>
      <section className="px-4">
        <p className="sect mb-2.5">匯出 Beancount</p>
        <div
          role="radiogroup"
          aria-label="匯出範圍"
          className="divide-y divide-border/40 overflow-hidden rounded-2xl bg-secondary/50"
        >
          {options.map((o) => {
            const on = choice === o.key;
            const detail = [o.hint, countText(o.key)].filter(Boolean).join(" · ");
            return (
              <div key={o.key}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => pick(o.key)}
                  disabled={busy}
                  className={rowClass}
                >
                  <span
                    className={`flex size-5 shrink-0 items-center justify-center rounded-full border ${
                      on ? "border-primary bg-primary text-primary-foreground" : "border-border"
                    }`}
                  >
                    {on && <Check className="size-3" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm">{o.label}</span>
                    {detail && (
                      <span className="block text-xs text-muted-foreground">{detail}</span>
                    )}
                  </span>
                </button>
                {o.key === "custom" && on && (
                  <div className="px-4 pb-3">
                    <DateRangePicker
                      from={from}
                      to={to}
                      open={pickerOpen}
                      onOpenChange={setPickerOpen}
                      onChange={(f, t) => {
                        setFrom(f);
                        setTo(t);
                      }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <p className="mt-2 px-1 text-xs text-muted-foreground">
          上次匯出後的變動包含新增的紀錄，以及已匯出、之後被修改或刪除的紀錄。修正會寫成沖銷分錄，帶有
          splitbill_correction 標記；每筆都帶 splitbill_id，可以用來對照。
        </p>
      </section>

      <section className="px-4">
        <div className="divide-y divide-border/40 overflow-hidden rounded-2xl bg-secondary/50">
          {platform.canDownloadExport && (
            <button type="button" onClick={download} disabled={!ready} className={rowClass}>
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Download className="size-3.5" />
              </span>
              <p className="min-w-0 flex-1 text-sm">
                {pending === "download" ? "匯出中…" : "下載 .beancount"}
              </p>
            </button>
          )}
          {summary?.telegramLinked !== false && (
            <button type="button" onClick={send} disabled={!ready} className={rowClass}>
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Send className="size-3.5" />
              </span>
              <p className="min-w-0 flex-1 text-sm">
                {pending === "send" ? "傳送中…" : "傳到我的私訊"}
              </p>
            </button>
          )}
        </div>
        {message && (
          <p
            className={`mt-2 px-1 text-xs ${message.ok ? "text-muted-foreground" : "text-destructive"}`}
          >
            {message.text}
          </p>
        )}
      </section>
    </>
  );
}
