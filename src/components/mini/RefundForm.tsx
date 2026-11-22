"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { skipToken } from "@reduxjs/toolkit/query";
import { ArrowLeft, Calendar as CalendarIcon, Check, ChevronRight, X } from "lucide-react";

import { Panel } from "@/components/mini/Panel";
import { useAuthMode } from "@/components/AuthProvider";
import { Avatar } from "@/components/mini/Avatar";
import { ConfirmDialog } from "@/components/mini/ConfirmDialog";
import { MemberSelect } from "@/components/mini/MemberSelect";
import { NoteBox, NoteToggle, useNoteToggle } from "@/components/mini/NoteField";
import { ReceiptPhotos, useReceiptPhotos } from "@/components/mini/ReceiptPhotos";
import { SegmentedControl } from "@/components/mini/SegmentedControl";
import { ErrorNote } from "@/components/mini/ErrorNote";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { recordHistoryHref } from "@/lib/activity-link";
import { apiErrorStatus, deleteErrorMessage, saveErrorMessage } from "@/lib/api-error";
import type { RefundDetail, RefundParent } from "@/lib/api-types";
import { viaText } from "@/lib/app-ui";
import { dayToLocalDate, localDateToDay } from "@/lib/day";
import { stampLabel } from "@/lib/format";
import { FORMER_MEMBER, labelUser, memberLabels } from "@/lib/label";
import { rateSourceLabel } from "@/lib/rate-source-label";
import { defaultRefundDescription, ratioShares } from "@/lib/refund";
import { useTelegramBackButton } from "@/lib/use-tg-back-button";
import { cn } from "@/lib/utils";
import { NOTE_MAX, SUPPORTED_CURRENCIES, type RefundSplit } from "@/lib/zod";
import {
  useCreateRefundMutation,
  useDeleteRefundMutation,
  useGetEffectiveRateQuery,
  useUpdateRefundMutation,
} from "@/store/api";

type Member = {
  id: number;
  displayName: string | null;
  firstName: string | null;
  lastName?: string | null;
  username: string | null;
};

type Props = {
  groupId: number;
  defaultCurrency: string;
  currentUserId: number;
  members: Member[];
  photos?: Record<number, string | null>;
  /** The expense the refund came back on. */
  parent: RefundParent;
  initial?: RefundDetail;
  /** Where to go after save / delete: the expense's edit form. */
  returnPath: string;
};

/** A typed amount that is a positive number, or null. */
function positive(v: string): number | null {
  const x = parseFloat(v);
  return Number.isFinite(x) && x > 0 ? x : null;
}

/**
 * The refund form (issue #178), laid out like the expense form: 金額／幣別, 匯率, 日期,
 * 說明 (＋ 備註), 收據照片, 收款人, then how it is shared back — 照原分攤比例 (the
 * expense's split, recomputed if that split changes later) or 自訂退稅金額 per person.
 */
export function RefundForm({
  groupId,
  defaultCurrency,
  currentUserId,
  members,
  photos,
  parent,
  initial,
  returnPath,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const mode = useAuthMode();
  const appBase = mode === "web" ? "/app" : "/mini";
  const isEdit = !!initial;
  const labels = useMemo(() => memberLabels(members), [members]);

  const backToForm = useCallback(() => router.push(returnPath), [router, returnPath]);
  useTelegramBackButton(backToForm);

  const [amount, setAmount] = useState(initial ? initial.amount.toFixed(2) : "");
  const [currency, setCurrency] = useState(initial?.currency ?? parent.currency);
  // A pinned rate is shown only while it targets the group's current default currency.
  const [fxRate, setFxRate] = useState(
    initial?.fxRate != null && initial.fxQuote === defaultCurrency ? String(initial.fxRate) : "",
  );
  const [date, setDate] = useState<Date>(initial ? dayToLocalDate(initial.refundedAt) : new Date());
  const [description, setDescription] = useState(
    initial?.description ?? defaultRefundDescription(parent.description),
  );
  const [note, setNote] = useState(initial?.note ?? "");
  const noteToggle = useNoteToggle(initial?.note);
  const receipts = useReceiptPhotos(initial);
  const [receivedBy, setReceivedBy] = useState(
    // Default: whoever paid the expense, since a refund usually goes back to the card it was
    // paid with. The person recording it when the payer can't be read.
    String(initial?.receivedBy ?? parent.payers[0]?.userId ?? currentUserId),
  );
  const [split, setSplit] = useState<RefundSplit>(initial?.split ?? "ratio");
  // Custom amounts per member, as typed. Starts from the saved shares, or from the ratio.
  const total = positive(amount) ?? 0;
  const [custom, setCustom] = useState<Record<number, { included: boolean; value: string }>>(() => {
    const seed =
      initial?.split === "custom"
        ? initial.shares
        : ratioShares(initial?.amount ?? 0, parent.splits);
    return Object.fromEntries(
      members.map((m) => {
        const s = seed.find((x) => x.userId === m.id);
        const inParent = parent.splits.some((p) => p.userId === m.id);
        return [m.id, { included: s ? true : inParent, value: s ? s.amount.toFixed(2) : "" }];
      }),
    );
  });

  const ratio = useMemo(() => ratioShares(total, parent.splits), [total, parent.splits]);
  const customSum = Object.values(custom).reduce(
    (sum, c) => sum + (c.included ? parseFloat(c.value) || 0 : 0),
    0,
  );
  const customBalanced = Math.abs(customSum - total) < 0.005;

  // The same rate rules as any record: a typed rate, else the group's custom rate or the
  // market rate on the refund's own day. Not tied to the expense's rate, by decision.
  const isForeign = currency !== defaultCurrency;
  const {
    data: effectiveRate,
    currentData: currentRate,
    isFetching,
  } = useGetEffectiveRateQuery(
    isForeign ? { groupId, base: currency, date: localDateToDay(date) } : skipToken,
  );
  const rateFetching = isFetching && currentRate === undefined;

  const [createRefund] = useCreateRefundMutation();
  const [updateRefund] = useUpdateRefundMutation();
  const [deleteRefund] = useDeleteRefundMutation();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rateValid = fxRate === "" || positive(fxRate) !== null;
  const valid =
    total > 0 &&
    rateValid &&
    receivedBy !== "" &&
    note.length <= NOTE_MAX &&
    (split === "ratio" ? ratio.length > 0 : customBalanced);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setSubmitting(true);
    setError(null);
    const body = {
      amount: total,
      currency,
      fxRate: isForeign && fxRate !== "" ? parseFloat(fxRate) : null,
      description: description.trim() || null,
      note: note.trim() || null,
      receivedBy: Number(receivedBy),
      refundedAt: localDateToDay(date),
      split,
      ...(split === "custom" && {
        shares: Object.entries(custom)
          .filter(([, c]) => c.included && (parseFloat(c.value) || 0) > 0)
          .map(([userId, c]) => ({ userId: Number(userId), amount: parseFloat(c.value) })),
      }),
      receiptFileIds: receipts.fileIds,
    };
    try {
      if (initial) {
        await updateRefund({ groupId, refundId: initial.id, expenseId: parent.id, body }).unwrap();
      } else {
        await createRefund({ groupId, expenseId: parent.id, body }).unwrap();
      }
    } catch (err) {
      setSubmitting(false);
      setError(saveErrorMessage(err, "這筆退稅"));
      return;
    }
    router.push(returnPath);
  }

  // Attribution, as on the other forms: who recorded it and the last edit.
  const recorder =
    initial?.createdBy != null ? members.find((m) => m.id === initial.createdBy) : undefined;
  const recordedBy = recorder
    ? labelUser({ ...recorder, userId: recorder.id }, currentUserId)
    : initial?.createdBy != null
      ? FORMER_MEMBER
      : null;
  const recordedBySomeoneElse = initial?.createdBy != null && initial.createdBy !== currentUserId;
  const lastEditor = initial?.lastActivity
    ? members.find((m) => m.id === initial.lastActivity?.actorId)
    : undefined;
  const lastEdit = initial?.lastActivity
    ? {
        by: lastEditor
          ? labelUser({ ...lastEditor, userId: lastEditor.id }, currentUserId)
          : FORMER_MEMBER,
        at: initial.lastActivity.at,
        via: initial.lastActivity.via,
      }
    : null;

  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  async function handleDelete() {
    if (!initial) return;
    setDeletePending(true);
    try {
      await deleteRefund({ groupId, refundId: initial.id, expenseId: parent.id }).unwrap();
    } catch (err) {
      setDeletePending(false);
      setDeleteError(deleteErrorMessage({ status: apiErrorStatus(err) ?? 0 }, "這筆退稅"));
      return;
    }
    setDeletePending(false);
    router.push(returnPath);
  }

  const nameOf = (userId: number) => labels.get(userId) ?? FORMER_MEMBER;

  return (
    <>
      <form onSubmit={onSubmit} className="flex flex-col gap-5 px-4 py-4">
        {/* Header */}
        <div className="flex min-w-0 items-start gap-2">
          {mode === "web" && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="shrink-0 rounded-lg"
              onClick={backToForm}
            >
              <ArrowLeft className="size-4" />
            </Button>
          )}
          <div className="min-w-0">
            <h1 className="text-lg font-semibold">{isEdit ? "編輯退稅" : "新增退稅"}</h1>
            <Link
              href={returnPath}
              className="num block truncate text-xs text-muted-foreground hover:underline"
            >
              原支出：{parent.description || "支出"} · {parent.spentAt.slice(5).replace("-", "/")} ›
            </Link>
          </div>
        </div>

        {/* Amount + currency */}
        <div className="flex gap-2">
          <div className="flex flex-1 flex-col gap-2">
            <label htmlFor="refund-amount" className="text-sm font-medium leading-none">
              金額
            </label>
            <Input
              id="refund-amount"
              type="number"
              step="0.01"
              min="0.01"
              inputMode="decimal"
              className="num text-base font-semibold"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div className="flex w-28 flex-col gap-2">
            <span className="text-sm font-medium leading-none">幣別</span>
            <Select
              value={currency}
              onValueChange={(c) => {
                setCurrency(c);
                setFxRate("");
              }}
            >
              <SelectTrigger aria-label="幣別">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SUPPORTED_CURRENCIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Rate */}
        {isForeign && (
          <div className="flex flex-col gap-2">
            <label htmlFor="refund-fx" className="text-sm font-medium leading-none">
              匯率（1 {currency} = ? {defaultCurrency}）
            </label>
            <div className="relative">
              <Input
                id="refund-fx"
                type="number"
                step="any"
                min="0"
                inputMode="decimal"
                className="num"
                placeholder={
                  effectiveRate?.rate != null && !rateFetching
                    ? `${effectiveRate.rate}（${rateSourceLabel(effectiveRate)}）`
                    : rateFetching
                      ? ""
                      : "無法取得匯率，請手動輸入"
                }
                value={fxRate}
                onChange={(e) => setFxRate(e.target.value)}
              />
              {fxRate === "" && rateFetching && (
                <Skeleton className="pointer-events-none absolute left-3 top-1/2 h-4 w-20 -translate-y-1/2" />
              )}
            </div>
            {(() => {
              const rate = positive(fxRate) ?? effectiveRate?.rate ?? null;
              if (fxRate === "" && rateFetching && total > 0)
                return <Skeleton className="h-4 w-48" />;
              return rate != null && total > 0 ? (
                <p className="num text-xs text-muted-foreground">
                  ≈ {(total * rate).toFixed(2)} {defaultCurrency}
                </p>
              ) : null;
            })()}
            {!rateValid && <p className="text-sm text-destructive">請輸入有效匯率</p>}
          </div>
        )}

        {/* Date */}
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium leading-none">日期</span>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                className="w-full justify-start text-base font-normal md:text-sm"
              >
                <CalendarIcon />
                {localDateToDay(date)}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={date}
                onSelect={(d) => d && setDate(d)}
                initialFocus
              />
            </PopoverContent>
          </Popover>
        </div>

        {/* Description + note */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <label htmlFor="refund-desc" className="text-sm font-medium leading-none">
              說明
            </label>
            <NoteToggle
              open={noteToggle.open}
              hasText={note.trim() !== ""}
              onToggle={noteToggle.toggle}
            />
          </div>
          <Input
            id="refund-desc"
            maxLength={500}
            placeholder="例如：藥妝 退稅"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          {noteToggle.open && (
            <NoteBox
              value={note}
              onChange={setNote}
              placeholder="選填，例如：機場退稅櫃台、扣了手續費"
              autoFocus={noteToggle.autoFocus}
            />
          )}
        </div>

        <ReceiptPhotos
          state={receipts}
          initialFileIds={initial ? initial.receiptFileIds : null}
          recordLabel="這筆退稅"
        />

        {/* Who received it */}
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium leading-none">收款人</span>
          <MemberSelect
            value={receivedBy}
            onValueChange={setReceivedBy}
            members={members}
            photos={photos}
            placeholder="選擇收款人"
          />
        </div>

        {/* How it is shared back */}
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium leading-none">分帳方式</span>
          <SegmentedControl
            label="分帳方式"
            value={split}
            options={[
              { value: "ratio", label: "照原分攤比例" },
              { value: "custom", label: "自訂退稅金額" },
            ]}
            onChange={(value) => {
              if (value === "custom" && split === "ratio") {
                // Start the custom amounts from what the ratio gives now.
                setCustom((prev) =>
                  Object.fromEntries(
                    Object.entries(prev).map(([id, c]) => {
                      const r = ratio.find((x) => x.userId === Number(id));
                      return [id, { included: !!r, value: r ? r.amount.toFixed(2) : c.value }];
                    }),
                  ),
                );
              }
              setSplit(value);
            }}
          />
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium leading-none">參與者</span>
          <Panel>
            {split === "ratio"
              ? parent.splits.map((p) => {
                  const share = ratio.find((r) => r.userId === p.userId);
                  return (
                    <div key={p.userId} className="flex min-h-[60px] items-center gap-3 px-4 py-3">
                      <Avatar
                        src={photos?.[p.userId] ?? null}
                        name={nameOf(p.userId)}
                        userId={p.userId}
                        size="sm"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm leading-tight">{nameOf(p.userId)}</div>
                        <div className="num mt-0.5 text-xs text-muted-foreground">
                          原分攤 {p.amount.toFixed(2)} {parent.currency}
                        </div>
                      </div>
                      <span className="num text-sm font-semibold">
                        {(share?.amount ?? 0).toFixed(2)}
                      </span>
                    </div>
                  );
                })
              : members.map((m) => {
                  const c = custom[m.id] ?? { included: false, value: "" };
                  return (
                    <div key={m.id} className="flex min-h-[60px] items-center gap-3 px-4 py-3">
                      <Checkbox
                        checked={c.included}
                        aria-label={`${nameOf(m.id)} 分回`}
                        onCheckedChange={(v) =>
                          setCustom((prev) => ({ ...prev, [m.id]: { ...c, included: v === true } }))
                        }
                      />
                      <Avatar
                        src={photos?.[m.id] ?? null}
                        name={nameOf(m.id)}
                        userId={m.id}
                        size="sm"
                      />
                      <div className="min-w-0 flex-1 truncate text-sm leading-tight">
                        {nameOf(m.id)}
                      </div>
                      {c.included && (
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          inputMode="decimal"
                          aria-label={`${nameOf(m.id)} 分回金額`}
                          className="num w-24 shrink-0 text-right"
                          value={c.value}
                          onChange={(e) =>
                            setCustom((prev) => ({
                              ...prev,
                              [m.id]: { ...c, value: e.target.value },
                            }))
                          }
                        />
                      )}
                    </div>
                  );
                })}
          </Panel>
          <div className="rounded-2xl bg-secondary/50 px-4 py-3">
            {split === "ratio" ? (
              <span className="num flex items-center gap-1.5 text-sm text-muted-foreground">
                依「{parent.description || "支出"}」的分攤 · 共 {ratio.length} 人
                <Check className="size-3.5 shrink-0" />
              </span>
            ) : (
              <span
                className={cn(
                  "num flex items-center gap-1.5 text-sm",
                  customBalanced ? "text-muted-foreground" : "text-rose-500",
                )}
              >
                {customSum.toFixed(2)} / {total.toFixed(2)} {currency}
                {!customBalanced && total > 0 && (
                  <>
                    {" "}
                    · {customSum < total ? "還差" : "超出"} {Math.abs(total - customSum).toFixed(2)}
                  </>
                )}
                {customBalanced ? (
                  <Check className="size-3.5 shrink-0" />
                ) : (
                  <X className="size-3.5 shrink-0" />
                )}
              </span>
            )}
          </div>
        </div>

        {error && <ErrorNote>{error}</ErrorNote>}

        {isEdit && recordedBy && (
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">
              由 {recordedBy} {initial?.createdVia ? `${viaText(initial.createdVia)} ` : ""}
              {initial?.createdAt ? `於 ${stampLabel(initial.createdAt)} ` : ""}記錄
            </p>
            {lastEdit && (
              <Link
                href={recordHistoryHref({
                  appBase,
                  groupId,
                  recordId: initial!.id,
                  from: pathname,
                })}
                className="-mx-2 flex items-center justify-between gap-2 rounded-lg px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-secondary"
              >
                <span>
                  最後由 {lastEdit.by} {lastEdit.via ? `${viaText(lastEdit.via)} ` : ""}於{" "}
                  {stampLabel(lastEdit.at)} 修改
                </span>
                <ChevronRight className="size-3.5 shrink-0" />
              </Link>
            )}
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <Button
            type="submit"
            disabled={submitting || !valid || receipts.uploading}
            className="flex-1 rounded-lg"
          >
            {submitting ? "儲存中…" : "儲存"}
          </Button>
          {isEdit && (
            <Button
              type="button"
              variant="destructive"
              disabled={deletePending}
              className="rounded-lg"
              onClick={() => setDeleteConfirmOpen(true)}
            >
              刪除
            </Button>
          )}
        </div>
        {deleteError && <ErrorNote>{deleteError}</ErrorNote>}
      </form>

      <ConfirmDialog
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        title="確認刪除"
        description={
          recordedBySomeoneElse && recordedBy
            ? `這筆是 ${recordedBy} 記錄的。刪除後無法復原，動態紀錄會留下這次刪除。`
            : "刪除後無法復原，動態紀錄會留下這次刪除。"
        }
        confirmLabel="刪除"
        variant="destructive"
        loading={deletePending}
        onConfirm={handleDelete}
      />
    </>
  );
}
