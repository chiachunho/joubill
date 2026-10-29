"use client";

import { useState } from "react";
import { skipToken } from "@reduxjs/toolkit/query";
import { ArrowRightLeft, Loader2, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiErrorText } from "@/lib/api-error";
import type { RateRow } from "@/lib/api-types";
import { affectedCurrencyFor } from "@/lib/fx-shared";
import { SUPPORTED_CURRENCIES } from "@/lib/zod";
import {
  useDeleteRateMutation,
  useGetEffectiveRateQuery,
  useGetRatesQuery,
  usePutRateMutation,
} from "@/store/api";

type Props = {
  groupId: string;
  /** Group default currency from the page's settings query (stays in sync with the 預設貨幣 select). */
  defaultCurrency: string;
};

/** Trim a stored rate for display: 0.2200000000 → "0.22". */
function fmtRate(rate: number): string {
  return String(parseFloat(rate.toFixed(6)));
}

/** "3 筆支出、1 筆還款" (settlements omitted when zero). */
function fmtAffected(expenses: number, settlements: number): string {
  return settlements > 0 ? `${expenses} 筆支出、${settlements} 筆還款` : `${expenses} 筆支出`;
}

/**
 * Group-wide custom FX rates. A rate set here overrides the market rate for
 * ALL expenses of the group in that currency (past and future). Renders as
 * the sole content of the 自訂匯率 settings sub-page (Mini App and Web App
 * each have a copy) — no internal heading, the page owns its own `<h1>`.
 */
export function CustomRatesSection({ groupId, defaultCurrency }: Props) {
  const { data, error } = useGetRatesQuery(groupId);
  const [putRate] = usePutRateMutation();
  const [deleteRate] = useDeleteRateMutation();

  const [base, setBase] = useState<string>("");
  const [rateInput, setRateInput] = useState("");
  /** Which confirm-dialog choice is in flight (null = not saving). */
  const [savingMode, setSavingMode] = useState<"all" | "lock" | null>(null);
  const saving = savingMode !== null;
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<RateRow | null>(null);
  /** Which delete-dialog choice is in flight (null = not deleting). */
  const [deleteMode, setDeleteMode] = useState<"plain" | "lock" | null>(null);
  const deleting = deleteMode !== null;
  const [errMsg, setErrMsg] = useState<string | null>(null);

  // Market reference + counts of existing records the new rate would re-convert.
  // Saving must wait for the counts of the CURRENT currency (`currentData`, not the
  // previous currency's `data` that stays on screen while a new one loads), or the
  // scope dialog could be skipped / show another currency's numbers.
  const { currentData: reference } = useGetEffectiveRateQuery(
    base && base !== defaultCurrency ? { groupId, base, counts: true } : skipToken,
  );
  const countsReady = reference !== undefined;
  const affectedExpenses = reference?.affectedExpenses ?? 0;
  const affectedSettlements = reference?.affectedSettlements ?? 0;
  const affectedTotal = affectedExpenses + affectedSettlements;

  // Same counts for the rate being deleted (its records fall back to market rates).
  const deleteCurrency = deleteTarget ? affectedCurrencyFor(deleteTarget, defaultCurrency) : null;
  const { currentData: deleteCounts } = useGetEffectiveRateQuery(
    deleteCurrency ? { groupId, base: deleteCurrency, counts: true } : skipToken,
  );
  const deleteCountsReady = !deleteCurrency || deleteCounts !== undefined;
  const deleteAffectedTotal = deleteCurrency
    ? (deleteCounts?.affectedExpenses ?? 0) + (deleteCounts?.affectedSettlements ?? 0)
    : 0;

  const parsedRate = parseFloat(rateInput);
  const canSave =
    base !== "" && Number.isFinite(parsedRate) && parsedRate > 0 && !saving && countsReady;

  async function save(mode: "all" | "lock") {
    if (saving) return;
    setSavingMode(mode);
    setErrMsg(null);
    try {
      // Saving invalidates the rates, the balances, the stats and every record's converted amount.
      await putRate({
        groupId,
        base,
        quote: defaultCurrency,
        rate: parsedRate,
        lockExisting: mode === "lock",
      }).unwrap();
      setBase("");
      setRateInput("");
      setConfirmOpen(false);
    } catch (e) {
      setErrMsg(apiErrorText(e, "儲存失敗，請再試一次"));
    } finally {
      setSavingMode(null);
    }
  }

  /** Existing records would be re-converted — let the user pick the scope first. */
  function requestSave() {
    if (!canSave) return;
    if (affectedTotal > 0) setConfirmOpen(true);
    else void save("all");
  }

  async function remove(mode: "plain" | "lock") {
    if (!deleteTarget || deleting) return;
    setDeleteMode(mode);
    setErrMsg(null);
    try {
      await deleteRate({
        groupId,
        base: deleteTarget.base,
        quote: deleteTarget.quote,
        lock: mode === "lock",
      }).unwrap();
      setDeleteTarget(null);
    } catch (e) {
      setErrMsg(apiErrorText(e, "刪除失敗，請再試一次"));
    } finally {
      setDeleteMode(null);
    }
  }

  const rates = data?.rates ?? [];

  return (
    <section className="px-4">
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
                onClick={() => setDeleteTarget(row)}
                disabled={deleting}
                className="shrink-0 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-30"
                aria-label={`刪除 ${row.base} 自訂匯率`}
              >
                {deleting && deleteTarget?.id === row.id ? (
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
              placeholder={reference?.marketRate != null ? fmtRate(reference.marketRate) : "匯率"}
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
          {base && affectedTotal > 0 && (
            <p className="text-xs text-muted-foreground">
              帳本中已有 {fmtAffected(affectedExpenses, affectedSettlements)}（{base}
              ），儲存時可選擇是否套用到這些舊紀錄。
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

      <Dialog open={confirmOpen} onOpenChange={saving ? undefined : setConfirmOpen}>
        <DialogContent className="max-w-sm rounded-2xl">
          <DialogHeader>
            <DialogTitle>套用範圍</DialogTitle>
            <DialogDescription>
              帳本中已有 {fmtAffected(affectedExpenses, affectedSettlements)} 使用 {base}
              （不含已自訂單筆匯率者）。新匯率 1 {base} = {rateInput} {defaultCurrency}{" "}
              要套用到哪些紀錄？「只套用到之後」會把既有紀錄鎖定在目前使用的匯率，餘額不變。
            </DialogDescription>
          </DialogHeader>
          {errMsg && <p className="text-sm text-destructive">{errMsg}</p>}
          {/* DialogFooter flips to flex-row at sm: — keep the stacked layout on all widths. */}
          <DialogFooter className="flex-col gap-2 sm:flex-col sm:justify-start sm:space-x-0">
            <Button
              className="w-full rounded-lg"
              disabled={saving}
              onClick={() => void save("lock")}
            >
              {savingMode === "lock" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                "只套用到之後的紀錄"
              )}
            </Button>
            <Button
              variant="secondary"
              className="w-full rounded-lg"
              disabled={saving}
              onClick={() => void save("all")}
            >
              {savingMode === "all" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                "套用到全部（重算舊紀錄）"
              )}
            </Button>
            <Button
              variant="outline"
              className="w-full rounded-lg"
              disabled={saving}
              onClick={() => setConfirmOpen(false)}
            >
              取消
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteTarget !== null}
        onOpenChange={deleting ? undefined : (open) => !open && setDeleteTarget(null)}
      >
        <DialogContent className="max-w-sm rounded-2xl">
          <DialogHeader>
            <DialogTitle>刪除自訂匯率</DialogTitle>
            <DialogDescription>
              {!deleteCountsReady ? (
                "正在確認受影響的紀錄…"
              ) : deleteTarget && deleteCurrency && deleteAffectedTotal > 0 ? (
                <>
                  帳本中有{" "}
                  {fmtAffected(
                    deleteCounts?.affectedExpenses ?? 0,
                    deleteCounts?.affectedSettlements ?? 0,
                  )}{" "}
                  正使用 1 {deleteTarget.base} = {fmtRate(deleteTarget.rate)} {deleteTarget.quote}
                  。直接刪除後，這些紀錄會改用市場匯率重新換算；
                  「鎖定舊紀錄」會讓它們維持在這個匯率，只有之後的新紀錄改用市場匯率。
                </>
              ) : deleteTarget && !deleteCurrency ? (
                "此設定目前未生效，刪除不會影響任何紀錄。"
              ) : (
                "沒有紀錄使用此匯率，可以直接刪除。"
              )}
            </DialogDescription>
          </DialogHeader>
          {errMsg && <p className="text-sm text-destructive">{errMsg}</p>}
          {/* DialogFooter flips to flex-row at sm: — keep the stacked layout on all widths. */}
          <DialogFooter className="flex-col gap-2 sm:flex-col sm:justify-start sm:space-x-0">
            {deleteCountsReady && deleteCurrency && deleteAffectedTotal > 0 && (
              <Button
                className="w-full rounded-lg"
                disabled={deleting}
                onClick={() => void remove("lock")}
              >
                {deleteMode === "lock" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  "刪除並鎖定舊紀錄"
                )}
              </Button>
            )}
            <Button
              variant={deleteCurrency && deleteAffectedTotal > 0 ? "destructive" : "default"}
              className="w-full rounded-lg"
              disabled={deleting || !deleteCountsReady}
              onClick={() => void remove("plain")}
            >
              {deleteMode === "plain" || !deleteCountsReady ? (
                <Loader2 className="size-4 animate-spin" />
              ) : deleteCurrency && deleteAffectedTotal > 0 ? (
                "直接刪除（改用市場匯率）"
              ) : (
                "刪除"
              )}
            </Button>
            <Button
              variant="outline"
              className="w-full rounded-lg"
              disabled={deleting}
              onClick={() => setDeleteTarget(null)}
            >
              取消
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
