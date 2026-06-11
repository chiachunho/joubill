"use client";

import { useState } from "react";
import { ArrowRightLeft, Loader2, Trash2 } from "lucide-react";
import useSWR, { mutate as globalMutate } from "swr";

import { ConfirmDialog } from "@/components/mini/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SUPPORTED_CURRENCIES } from "@/lib/zod";

type RateRow = { id: number; base: string; quote: string; rate: number; updatedAt: string };
type RatesResponse = { defaultCurrency: string; rates: RateRow[] };

type Props = {
  groupId: string;
  /** Group default currency from the page's settings SWR (stays in sync with the 預設貨幣 select). */
  defaultCurrency: string;
  rawFetch: (url: string, init?: RequestInit) => Promise<Response>;
};

/** Trim a stored rate for display: 0.2200000000 → "0.22". */
function fmtRate(rate: number): string {
  return String(parseFloat(rate.toFixed(6)));
}

/**
 * Group-wide custom FX rates. A rate set here overrides the market rate for
 * ALL expenses of the group in that currency (past and future). Shared by the
 * Mini App and Web App settings pages — auth is injected via `rawFetch`.
 */
export function CustomRatesSection({ groupId, defaultCurrency, rawFetch }: Props) {
  const { data, error, mutate } = useSWR<RatesResponse>(`/api/groups/${groupId}/rates`);

  const [base, setBase] = useState<string>("");
  const [rateInput, setRateInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  // Market reference + count of existing expenses the new rate would re-convert.
  const { data: reference } = useSWR<{
    marketRate: number | null;
    affectedExpenses: number;
  }>(
    base && base !== defaultCurrency
      ? `/api/groups/${groupId}/rates/effective?base=${base}`
      : null,
  );
  const affectedExpenses = reference?.affectedExpenses ?? 0;

  // Balances and stats are computed with these rates — refresh them after a change.
  function revalidateDerived() {
    globalMutate(`/api/groups/${groupId}/balance`);
    globalMutate(`/api/groups/${groupId}/stats`);
  }

  const parsedRate = parseFloat(rateInput);
  const canSave = base !== "" && Number.isFinite(parsedRate) && parsedRate > 0 && !saving;

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setErrMsg(null);
    try {
      const res = await rawFetch(`/api/groups/${groupId}/rates`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base, quote: defaultCurrency, rate: parsedRate }),
      });
      if (!res.ok) {
        setErrMsg("儲存失敗，請再試一次");
        return;
      }
      setBase("");
      setRateInput("");
      await mutate();
      revalidateDerived();
    } catch {
      setErrMsg("儲存失敗，請再試一次");
    } finally {
      setSaving(false);
      setConfirmOpen(false);
    }
  }

  /** Existing records get re-converted — make the user confirm when any exist. */
  function requestSave() {
    if (!canSave) return;
    if (affectedExpenses > 0) setConfirmOpen(true);
    else void save();
  }

  async function remove(row: RateRow) {
    if (deletingId !== null) return;
    setDeletingId(row.id);
    setErrMsg(null);
    try {
      const res = await rawFetch(
        `/api/groups/${groupId}/rates?base=${row.base}&quote=${row.quote}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        setErrMsg("刪除失敗，請再試一次");
        return;
      }
      await mutate();
      revalidateDerived();
    } catch {
      setErrMsg("刪除失敗，請再試一次");
    } finally {
      setDeletingId(null);
    }
  }

  const rates = data?.rates ?? [];

  return (
    <section className="px-4">
      <p className="sect mb-2.5">自訂匯率</p>
      <div className="divide-y divide-border/40 overflow-hidden rounded-2xl bg-secondary/50">
        {rates.map((row) => {
          const dormant = row.quote !== defaultCurrency;
          return (
            <div key={row.id} className="flex items-center gap-3 px-4 py-3">
              <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
                <ArrowRightLeft className="size-3.5 text-primary" />
              </div>
              <div className={`min-w-0 flex-1 ${dormant ? "opacity-40" : ""}`}>
                <p className="num text-sm">
                  1 {row.base} = {fmtRate(row.rate)} {row.quote}
                </p>
                {dormant && (
                  <p className="text-xs text-muted-foreground">
                    未生效（預設貨幣已改為 {defaultCurrency}）
                  </p>
                )}
              </div>
              <button
                onClick={() => remove(row)}
                disabled={deletingId !== null}
                className="shrink-0 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-30"
                aria-label={`刪除 ${row.base} 自訂匯率`}
              >
                {deletingId === row.id ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Trash2 className="size-3.5" />
                )}
              </button>
            </div>
          );
        })}
        {rates.length === 0 && !error && (
          <p className="px-4 py-3 text-sm text-muted-foreground">
            {data ? "未設定，使用市場匯率換算" : "載入中…"}
          </p>
        )}
        {error && <p className="px-4 py-3 text-sm text-muted-foreground">無法載入自訂匯率</p>}

        {/* Add / update row */}
        <div className="space-y-2 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">1</span>
            <Select value={base} onValueChange={setBase}>
              <SelectTrigger className="h-8 w-24 rounded-lg border-0 bg-background/60 text-sm">
                <SelectValue placeholder="幣別" />
              </SelectTrigger>
              <SelectContent>
                {SUPPORTED_CURRENCIES.filter((c) => c !== defaultCurrency).map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-sm text-muted-foreground">=</span>
            <Input
              type="number"
              step="any"
              min="0"
              inputMode="decimal"
              className="num h-8 flex-1 rounded-lg border-0 bg-background/60 text-sm"
              placeholder={
                reference?.marketRate != null ? fmtRate(reference.marketRate) : "匯率"
              }
              value={rateInput}
              onChange={(e) => setRateInput(e.target.value)}
            />
            <span className="text-sm text-muted-foreground">{defaultCurrency}</span>
            <Button
              type="button"
              size="sm"
              className="h-8 rounded-lg"
              disabled={!canSave}
              onClick={requestSave}
            >
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : "儲存"}
            </Button>
          </div>
          {base && reference?.marketRate != null && (
            <p className="num text-xs text-muted-foreground">
              市場參考：1 {base} ≈ {fmtRate(reference.marketRate)} {defaultCurrency}
            </p>
          )}
          {base && affectedExpenses > 0 && (
            <p className="text-xs text-muted-foreground">
              帳本中已有 <span className="num">{affectedExpenses}</span> 筆 {base}{" "}
              支出，儲存後將以新匯率重新換算。
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            設定後，此幣別的所有支出（含過去）都會以這個匯率換算。
          </p>
        </div>
      </div>
      {errMsg && (
        <div className="mt-2 rounded-lg bg-destructive/10 px-4 py-2.5 text-sm text-destructive">
          {errMsg}
          <button onClick={() => setErrMsg(null)} className="ml-2 text-xs underline opacity-70">
            關閉
          </button>
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="套用到既有紀錄"
        description={`帳本中已有 ${affectedExpenses} 筆 ${base} 支出。儲存後，這些紀錄（除已自訂單筆匯率者外）都會改以 1 ${base} = ${rateInput} ${defaultCurrency} 重新換算，餘額可能因此變動。`}
        confirmLabel="儲存"
        loading={saving}
        onConfirm={() => void save()}
      />
    </section>
  );
}
