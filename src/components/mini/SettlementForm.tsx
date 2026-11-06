"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { skipToken } from "@reduxjs/toolkit/query";
import { ArrowLeft, Calendar as CalendarIcon, ChevronRight } from "lucide-react";

import { ConfirmDialog } from "@/components/mini/ConfirmDialog";
import { MemberSelect } from "@/components/mini/MemberSelect";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuthMode } from "@/components/AuthProvider";
import { dayToLocalDate, localDateToDay } from "@/lib/day";
import { apiErrorStatus, apiErrorText, deleteErrorMessage } from "@/lib/api-error";
import { rateSourceLabel } from "@/lib/rate-source-label";
import { recordHistoryHref } from "@/lib/activity-link";
import { stampLabel } from "@/lib/format";
import { viaText } from "@/lib/agent-ui";
import { labelUser } from "@/lib/label";
import { cn } from "@/lib/utils";
import { useTelegramBackButton } from "@/lib/use-tg-back-button";
import { SUPPORTED_CURRENCIES, settlementFormSchema, type SettlementFormValues } from "@/lib/zod";
import {
  useCreateSettlementMutation,
  useDeleteSettlementMutation,
  useGetEffectiveRateQuery,
  useUpdateSettlementMutation,
} from "@/store/api";

type Member = {
  id: number;
  displayName: string | null;
  firstName: string | null;
  lastName?: string | null;
  username: string | null;
};

type Initial = {
  id: number;
  /** Required, not optional: an omitted field here is exactly how the
   *  attribution silently stopped rendering once before. */
  createdBy: number | null;
  /** When it was entered — distinct from settledAt, the date of the repayment.
   *  Required for the same reason createdBy is. */
  createdAt: string | null;
  /** The AI assistant it was entered through (issue #150): required, like createdBy. */
  createdVia: string | null;
  /** The most recent edit, or null when nobody has touched it since. */
  lastActivity: { actorId: number | null; at: string; via: string | null } | null;
  amount: number;
  currency: string;
  fxRate?: number | null;
  fxQuote?: string | null;
  settledAt: string;
  from: { userId: number };
  to: { userId: number };
};

type Props = {
  groupId: number;
  defaultCurrency: string;
  currentUserId: number;
  members: Member[];
  photos?: Record<number, string | null>;
  initial?: Initial;
  /** Where to navigate after save/delete. Defaults to /mini/groups/:groupId
   *  (the merged expense/settlement list). */
  returnPath?: string;
};

export function SettlementForm({
  groupId,
  defaultCurrency,
  currentUserId,
  members,
  photos,
  initial,
  returnPath,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const mode = useAuthMode();
  // "tma" → /mini, "web" → /app. Same split the fetchers make below.
  const appBase = mode === "web" ? "/app" : "/mini";
  const isEdit = !!initial;
  // A merge can leave a settlement whose two sides are now the same person. It can't pass the
  // from ≠ to rule, so it stays as it is until someone deletes it.
  const merged = !!initial && initial.from.userId === initial.to.userId;

  // Anyone in the group may edit or delete any record, so who entered it is
  // shown rather than enforced — attribution in place of a lock (see CLAUDE.md).
  const recorder =
    initial?.createdBy != null ? members.find((m) => m.id === initial.createdBy) : undefined;
  const recordedBy = recorder
    ? labelUser({ ...recorder, userId: recorder.id }, currentUserId)
    : null;
  const recordedBySomeoneElse = initial?.createdBy != null && initial.createdBy !== currentUserId;

  // Only rendered once someone has actually edited the record — see ExpenseForm.
  const lastEditor = initial?.lastActivity
    ? members.find((m) => m.id === initial.lastActivity?.actorId)
    : undefined;
  const lastEdit = initial?.lastActivity
    ? {
        by: lastEditor ? labelUser({ ...lastEditor, userId: lastEditor.id }, currentUserId) : "?",
        at: initial.lastActivity.at,
        via: initial.lastActivity.via,
      }
    : null;
  const back = returnPath ?? `/mini/groups/${groupId}`;

  const backToList = useCallback(() => {
    router.push(back);
  }, [router, back]);
  useTelegramBackButton(backToList);

  const form = useForm<SettlementFormValues>({
    resolver: zodResolver(settlementFormSchema),
    mode: "onChange",
    defaultValues: {
      fromUserId: initial ? String(initial.from.userId) : "",
      toUserId: initial ? String(initial.to.userId) : "",
      amount: initial ? initial.amount.toFixed(2) : "",
      currency: (initial?.currency ?? defaultCurrency) as SettlementFormValues["currency"],
      // Restore a pinned rate only while it still targets the group's current
      // default currency; a dormant pin (default changed since) starts blank.
      fxRate:
        initial?.fxRate != null && initial.fxQuote === defaultCurrency
          ? String(initial.fxRate)
          : "",
      settledDate: initial ? dayToLocalDate(initial.settledAt) : new Date(),
    },
  });

  const amount = useWatch({ control: form.control, name: "amount" });
  const currency = useWatch({ control: form.control, name: "currency" });
  const settledDate = useWatch({ control: form.control, name: "settledDate" });
  const isForeignCurrency = currency !== defaultCurrency;

  // A rate typed for one currency is meaningless for another — clear the field
  // when the currency changes, restoring the saved pin when switching back to
  // the record's stored currency.
  useEffect(() => {
    const restored =
      initial?.fxRate != null &&
      initial.fxQuote === defaultCurrency &&
      currency === initial.currency
        ? String(initial.fxRate)
        : "";
    if (form.getValues("fxRate") !== restored) {
      form.setValue("fxRate", restored, { shouldValidate: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currency]);

  // Reference rate (group custom rate if set, else market rate as of the date).
  // `data` keeps the previous date's result while the new one loads, so nothing derived
  // from it is shown while `isFetching` (the ≈ line is a skeleton instead).
  const {
    data: effectiveRate,
    currentData: currentRate,
    isFetching,
  } = useGetEffectiveRateQuery(
    isForeignCurrency ? { groupId, base: currency, date: localDateToDay(settledDate) } : skipToken,
  );
  // Only a load for a NEW date counts; a background refresh of the same date keeps the value.
  const rateFetching = isFetching && currentRate === undefined;
  const [createSettlement] = useCreateSettlementMutation();
  const [updateSettlement] = useUpdateSettlementMutation();
  const [deleteSettlement] = useDeleteSettlementMutation();

  async function onSubmit(values: SettlementFormValues) {
    const body = {
      fromUserId: Number(values.fromUserId),
      toUserId: Number(values.toUserId),
      amount: parseFloat(values.amount),
      currency: values.currency,
      fxRate:
        values.currency !== defaultCurrency && values.fxRate !== ""
          ? parseFloat(values.fxRate)
          : null,
      settledAt: localDateToDay(values.settledDate),
    };

    try {
      if (isEdit) {
        await updateSettlement({ groupId, settlementId: initial!.id, body }).unwrap();
      } else {
        await createSettlement({ groupId, body }).unwrap();
      }
    } catch (e) {
      form.setError("root", {
        message: apiErrorText(e, `HTTP ${apiErrorStatus(e) ?? "error"}`),
      });
      return;
    }
    router.push(back);
  }

  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleDelete() {
    if (!initial) return;
    setDeletePending(true);
    try {
      await deleteSettlement({ groupId, settlementId: initial.id }).unwrap();
    } catch (e) {
      setDeletePending(false);
      setDeleteError(deleteErrorMessage({ status: apiErrorStatus(e) ?? 0 }, "這筆還款記錄"));
      return;
    }
    setDeletePending(false);
    router.push(back);
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-5 px-4 py-4">
        {/* Header */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            {mode === "web" && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="shrink-0 rounded-lg"
                onClick={backToList}
              >
                <ArrowLeft className="size-4" />
              </Button>
            )}
            <div>
              <h1 className="text-lg font-semibold">{isEdit ? "編輯還款記錄" : "新增還款記錄"}</h1>
              {isEdit && <p className="mt-0.5 text-xs text-muted-foreground">#{initial!.id}</p>}
            </div>
          </div>
        </div>

        {/* From */}
        <FormField
          control={form.control}
          name="fromUserId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>付款人（誰轉帳）</FormLabel>
              <MemberSelect
                value={field.value}
                onValueChange={field.onChange}
                members={members}
                photos={photos}
                placeholder="選擇付款人"
              />
              <FormMessage />
            </FormItem>
          )}
        />

        {/* To */}
        <FormField
          control={form.control}
          name="toUserId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>收款人（誰收到錢）</FormLabel>
              <MemberSelect
                value={field.value}
                onValueChange={field.onChange}
                members={members}
                photos={photos}
                placeholder="選擇收款人"
              />
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Amount + currency */}
        <div className="flex gap-2">
          <FormField
            control={form.control}
            name="amount"
            render={({ field }) => (
              <FormItem className="flex-1">
                <FormLabel>金額</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    step="0.01"
                    min="0.01"
                    inputMode="decimal"
                    className="num text-base font-semibold"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="currency"
            render={({ field }) => (
              <FormItem className="w-28">
                <FormLabel>幣別</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {SUPPORTED_CURRENCIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormItem>
            )}
          />
        </div>

        {/* Custom FX rate (foreign-currency settlements only) */}
        {isForeignCurrency && (
          <FormField
            control={form.control}
            name="fxRate"
            render={({ field }) => {
              const typed = parseFloat(field.value);
              const usingCustom = field.value !== "" && Number.isFinite(typed) && typed > 0;
              const rateInUse = usingCustom ? typed : (effectiveRate?.rate ?? null);
              const total = parseFloat(amount) || 0;
              return (
                <FormItem>
                  <FormLabel>
                    匯率（1 {currency} = ? {defaultCurrency}）
                  </FormLabel>
                  <div className="relative">
                    <FormControl>
                      <Input
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
                        {...field}
                      />
                    </FormControl>
                    {field.value === "" && rateFetching && (
                      <Skeleton className="pointer-events-none absolute left-3 top-1/2 h-4 w-20 -translate-y-1/2" />
                    )}
                  </div>
                  {!usingCustom && rateFetching && total > 0 ? (
                    <Skeleton className="h-4 w-48" />
                  ) : rateInUse != null && total > 0 ? (
                    <p className="num text-xs text-muted-foreground">
                      ≈ {(total * rateInUse).toFixed(2)} {defaultCurrency}
                    </p>
                  ) : null}
                  <FormMessage />
                </FormItem>
              );
            }}
          />
        )}

        {/* Date */}
        <FormField
          control={form.control}
          name="settledDate"
          render={({ field }) => (
            <FormItem>
              <FormLabel>日期</FormLabel>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    className={cn("w-full justify-start text-base font-normal md:text-sm")}
                  >
                    <CalendarIcon />
                    {localDateToDay(field.value)}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={field.value}
                    onSelect={(d) => d && field.onChange(d)}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </FormItem>
          )}
        />

        {form.formState.errors.root && (
          <p className="rounded-lg bg-destructive/10 px-4 py-2.5 text-sm text-destructive">
            {form.formState.errors.root.message}
          </p>
        )}

        {/* Actions */}
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
        {merged && (
          <p className="rounded-lg bg-secondary px-3.5 py-2.5 text-sm text-muted-foreground">
            付款人和收款人已合併成同一個人，這筆還款無法再編輯，只能刪除。
          </p>
        )}
        <div className="flex gap-2 pt-1">
          <Button
            type="submit"
            disabled={merged || form.formState.isSubmitting || !form.formState.isValid}
            className="flex-1 rounded-lg"
          >
            {form.formState.isSubmitting ? "儲存中…" : "儲存"}
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
        {deleteError && (
          <p className="rounded-lg bg-destructive/10 px-4 py-2.5 text-sm text-destructive">
            {deleteError}
          </p>
        )}
      </form>

      <ConfirmDialog
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        title="確認刪除"
        description={
          recordedBySomeoneElse && recordedBy
            ? `這筆是 ${recordedBy} 記錄的，刪除後無法復原。`
            : "這筆還款記錄將被永久刪除。"
        }
        confirmLabel="刪除"
        variant="destructive"
        loading={deletePending}
        onConfirm={handleDelete}
      />
    </Form>
  );
}
