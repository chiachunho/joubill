"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useFieldArray, useForm } from "react-hook-form";
import { mutate } from "swr";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, Calendar as CalendarIcon, Check, ImagePlus, Loader2, Trash2, X } from "lucide-react";

import { Avatar } from "@/components/mini/Avatar";
import { ConfirmDialog } from "@/components/mini/ConfirmDialog";
import { MemberSelect } from "@/components/mini/MemberSelect";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { labelMember } from "@/lib/label";
import { computeSplits } from "@/lib/splits";
import { cn } from "@/lib/utils";
import { useAuthMode } from "@/components/AuthProvider";
import { useTelegramBackButton } from "@/lib/use-tg-back-button";
import { tmaRawFetch, webRawFetch } from "@/lib/web-fetch";
import {
  SUPPORTED_CURRENCIES,
  expenseFormSchema,
  type ExpenseFormValues,
} from "@/lib/zod";

type Member = { id: number; firstName: string; lastName?: string | null; username: string | null; status?: string | null };

type Initial = {
  id: number;
  amount: number;
  currency: string;
  description: string | null;
  payerId: number;
  spentAt: string;
  receiptFileId?: string | null;
  splits: Array<{ debtorId: number; amount: number; shareType: string }>;
};

type Props = {
  groupId: number;
  defaultCurrency: string;
  currentUserId: number;
  members: Member[];
  photos?: Record<number, string | null>;
  initial?: Initial;
  /** Where to navigate after save/delete. Defaults to /mini/groups/:groupId. */
  returnPath?: string;
};

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dayToNoonUtcIso(d: Date): string {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 12)).toISOString();
}

function buildDefaults(props: Props): ExpenseFormValues {
  const { members, initial, defaultCurrency, currentUserId } = props;
  const shareType =
    initial?.splits[0]?.shareType === "exact" || initial?.splits[0]?.shareType === "percent"
      ? (initial.splits[0].shareType as ExpenseFormValues["shareType"])
      : "equal";
  const splitByDebtor = new Map((initial?.splits ?? []).map((s) => [s.debtorId, s.amount]));
  return {
    amount: initial ? initial.amount.toFixed(2) : "",
    currency: (initial?.currency ?? defaultCurrency) as ExpenseFormValues["currency"],
    description: initial?.description ?? "",
    payerId: String(initial?.payerId ?? currentUserId),
    spentDate: initial ? new Date(initial.spentAt) : new Date(),
    shareType,
    participants: members.map((m) => {
      const split = splitByDebtor.get(m.id);
      return {
        userId: m.id,
        included: initial ? split !== undefined : m.status !== "inactive",
        value: split !== undefined ? split.toFixed(2) : "",
      };
    }),
  };
}

export function ExpenseForm(props: Props) {
  const { groupId, members, photos, initial, returnPath } = props;
  const router = useRouter();
  const mode = useAuthMode();
  const isEdit = !!initial;
  const back = returnPath ?? `/mini/groups/${groupId}`;

  const backToGroup = useCallback(() => {
    router.push(back);
  }, [router, back]);
  useTelegramBackButton(backToGroup);

  const form = useForm<ExpenseFormValues>({
    resolver: zodResolver(expenseFormSchema),
    defaultValues: buildDefaults(props),
    mode: "onChange",
  });
  const { fields } = useFieldArray({ control: form.control, name: "participants" });

  const amount = form.watch("amount");
  const currency = form.watch("currency");
  const shareType = form.watch("shareType");
  const participants = form.watch("participants");

  const totalAmount = parseFloat(amount) || 0;
  const included = participants
    .filter((p) => p.included)
    .map((p) => ({ userId: p.userId, value: p.value }));
  const computedSplits = computeSplits(totalAmount, shareType, included);
  const inputSum = included.reduce((s, p) => s + (parseFloat(p.value) || 0), 0);
  const splitsBalanced =
    shareType === "percent"
      ? Math.abs(inputSum - 100) < 0.1
      : Math.abs(inputSum - totalAmount) < 0.02;

  // Invalidate every SWR key affected by an expense create/edit/delete. The
  // single-expense detail key must be included or re-opening the same record
  // shows stale pre-edit data (revalidateOnFocus is off + dedupe).
  function revalidateGroup() {
    mutate(`/api/groups/${groupId}/expenses`);
    mutate(`/api/groups/${groupId}/balance`);
    mutate(`/api/groups/${groupId}/stats`);
    if (initial) mutate(`/api/groups/${groupId}/expenses/${initial.id}`);
  }

  async function onSubmit(values: ExpenseFormValues) {
    const body = {
      amount: parseFloat(values.amount),
      currency: values.currency,
      description: values.description.trim() || null,
      payerId: Number(values.payerId),
      spentAt: dayToNoonUtcIso(values.spentDate),
      shareType: values.shareType,
      receiptFileId,
      splits: computeSplits(
        parseFloat(values.amount),
        values.shareType,
        values.participants
          .filter((p) => p.included)
          .map((p) => ({ userId: p.userId, value: p.value })),
      ),
    };

    const url = isEdit
      ? `/api/groups/${groupId}/expenses/${initial!.id}`
      : `/api/groups/${groupId}/expenses`;

    const fetchFn = mode === "web" ? webRawFetch : tmaRawFetch;
    const res = await fetchFn(url, {
      method: isEdit ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const parsed = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      form.setError("root", { message: parsed.error ?? `HTTP ${res.status}` });
      return;
    }
    revalidateGroup();
    router.push(back);
  }

  const [receiptFileId, setReceiptFileId] = useState<string | null>(
    initial?.receiptFileId ?? null,
  );
  const [receiptUploading, setReceiptUploading] = useState(false);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const [receiptImgLoading, setReceiptImgLoading] = useState(!!initial?.receiptFileId);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleReceiptChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setReceiptError(null);
    setReceiptUploading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const fetchFn = mode === "web" ? webRawFetch : tmaRawFetch;
      const res = await fetchFn("/api/tg-upload", { method: "POST", body });
      if (!res.ok) {
        const parsed = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        setReceiptError(parsed.error ?? "上傳失敗");
        return;
      }
      const { fileId } = (await res.json()) as { fileId: string };
      setReceiptFileId(fileId);
      setReceiptImgLoading(true);
    } catch {
      setReceiptError("上傳失敗，請再試一次");
    } finally {
      setReceiptUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleDelete() {
    if (!initial) return;
    setDeletePending(true);
    const fetchFn = mode === "web" ? webRawFetch : tmaRawFetch;
    const res = await fetchFn(`/api/groups/${groupId}/expenses/${initial.id}`, { method: "DELETE" });
    setDeletePending(false);
    if (!res.ok) { setDeleteError("刪除失敗，請再試一次"); return; }
    revalidateGroup();
    router.push(back);
  }

  return (
    <>
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-5 px-4 py-4">
        {/* Header */}
        <div className="flex items-center gap-2">
          {mode === "web" && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="shrink-0 rounded-lg"
              onClick={backToGroup}
            >
              <ArrowLeft className="size-4" />
            </Button>
          )}
          <div>
            <h1 className="text-lg font-semibold">{isEdit ? "編輯支出" : "新增支出"}</h1>
            {isEdit && (
              <p className="mt-0.5 text-xs text-muted-foreground">#{initial!.id}</p>
            )}
          </div>
        </div>

        {/* Amount + currency row */}
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

        {/* Date */}
        <FormField
          control={form.control}
          name="spentDate"
          render={({ field }) => (
            <FormItem>
              <FormLabel>日期</FormLabel>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full justify-start text-base font-normal md:text-sm"
                  >
                    <CalendarIcon />
                    {ymd(field.value)}
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

        {/* Description */}
        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>說明</FormLabel>
              <FormControl>
                <Input placeholder="例如：晚餐、機票" maxLength={500} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Receipt photo */}
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium leading-none">收據照片</span>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleReceiptChange}
          />
          {receiptFileId ? (
            <div className="relative w-full overflow-hidden rounded-2xl bg-secondary/50">
              {receiptImgLoading && (
                <Skeleton className="h-48 w-full rounded-none" />
              )}
              <button
                type="button"
                onClick={() => setLightboxOpen(true)}
                className="w-full"
                aria-label="查看收據大圖"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/tg-photo?fileId=${receiptFileId}`}
                  alt="收據"
                  className={cn(
                    "max-h-48 w-full object-contain transition-opacity duration-200",
                    receiptImgLoading ? "opacity-0 h-0" : "opacity-100",
                  )}
                  onLoad={() => setReceiptImgLoading(false)}
                  onError={() => setReceiptImgLoading(false)}
                />
              </button>
              <button
                type="button"
                onClick={() => setReceiptFileId(null)}
                className="absolute right-2 top-2 rounded-lg bg-black/50 p-1.5 text-white backdrop-blur-sm"
                aria-label="移除收據"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              disabled={receiptUploading}
              onClick={() => fileInputRef.current?.click()}
              className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-input bg-secondary/30 py-4 text-sm text-muted-foreground hover:bg-secondary/60 disabled:opacity-50"
            >
              {receiptUploading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ImagePlus className="size-4" />
              )}
              {receiptUploading ? "上傳中…" : "附上收據照片"}
            </button>
          )}
          {receiptError && (
            <p className="text-sm text-destructive">{receiptError}</p>
          )}
        </div>

        {/* Payer */}
        <FormField
          control={form.control}
          name="payerId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>付款人</FormLabel>
              <MemberSelect
                value={field.value}
                onValueChange={field.onChange}
                members={members}
                photos={photos}
              />
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Split type */}
        <FormField
          control={form.control}
          name="shareType"
          render={({ field }) => (
            <FormItem>
              <FormLabel>分帳方式</FormLabel>
              <div className="inline-flex w-full rounded-lg border border-input bg-secondary/40 p-0.5">
                {(["equal", "exact", "percent"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => field.onChange(m)}
                    aria-pressed={field.value === m}
                    className={cn(
                      "flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-all",
                      field.value === m
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {m === "equal" ? "均分" : m === "exact" ? "指定" : "比例"}
                  </button>
                ))}
              </div>
            </FormItem>
          )}
        />

        {/* Participants */}
        <FormField
          control={form.control}
          name="participants"
          render={() => (
            <FormItem>
              <FormLabel>參與者</FormLabel>
              <div className="overflow-hidden rounded-2xl bg-secondary/50 divide-y divide-border/40">
                {fields.map((f, i) => {
                  const m = members.find((x) => x.id === f.userId);
                  const isIncluded = participants[i]?.included ?? false;
                  const computed = computedSplits.find((x) => x.debtorId === f.userId);
                  return (
                    <div key={f.id} className="flex items-center gap-3 px-4 py-3">
                      <FormField
                        control={form.control}
                        name={`participants.${i}.included`}
                        render={({ field }) => (
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={(c) => field.onChange(c === true)}
                          />
                        )}
                      />
                      <Avatar
                        src={photos?.[f.userId] ?? null}
                        name={m ? labelMember(m) : String(f.userId)}
                        userId={f.userId}
                        size="sm"
                      />
                      <span className="flex-1 text-sm">{m ? labelMember(m) : `#${f.userId}`}</span>
                      {shareType === "equal" ? (
                        <Input
                          disabled
                          className="num w-24 text-right"
                          value={isIncluded && computed ? computed.amount.toFixed(2) : ""}
                        />
                      ) : (
                        <FormField
                          control={form.control}
                          name={`participants.${i}.value`}
                          render={({ field }) =>
                            shareType === "percent" ? (
                              <div className="relative">
                                <Input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  inputMode="decimal"
                                  className="num w-24 pr-6 text-right"
                                  disabled={!isIncluded}
                                  {...field}
                                />
                                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                                  %
                                </span>
                              </div>
                            ) : (
                              <Input
                                type="number"
                                step="0.01"
                                min="0"
                                inputMode="decimal"
                                className="num w-24 text-right"
                                disabled={!isIncluded}
                                {...field}
                              />
                            )
                          }
                        />
                      )}
                    </div>
                  );
                })}
              </div>
              {shareType !== "equal" && (
                <p
                  className={cn(
                    "flex items-center gap-1 text-sm num",
                    splitsBalanced ? "text-muted-foreground" : "text-rose-500",
                  )}
                >
                  {shareType === "percent"
                    ? `總計 ${inputSum.toFixed(2)}% / 100%`
                    : `總計 ${inputSum.toFixed(2)} / ${totalAmount.toFixed(2)} ${currency}`}
                  {splitsBalanced ? <Check className="size-3.5" /> : <X className="size-3.5" />}
                </p>
              )}
              <FormMessage />
            </FormItem>
          )}
        />

        {form.formState.errors.root && (
          <p className="rounded-lg bg-destructive/10 px-4 py-2.5 text-sm text-destructive">
            {form.formState.errors.root.message}
          </p>
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          <Button
            type="submit"
            disabled={form.formState.isSubmitting || !form.formState.isValid}
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
        description="這筆支出將被永久刪除。"
        confirmLabel="刪除"
        variant="destructive"
        loading={deletePending}
        onConfirm={handleDelete}
      />
    </Form>

    {/* Receipt lightbox */}
    <Dialog open={lightboxOpen} onOpenChange={setLightboxOpen}>
      <DialogContent className="border-0 bg-black/90 p-4 shadow-none backdrop-blur-sm max-w-[calc(100vw-2rem)] flex items-center justify-center [&>button]:text-white [&>button]:opacity-80 [&>button]:hover:opacity-100">
        <DialogTitle className="sr-only">收據大圖</DialogTitle>
        {receiptFileId && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/tg-photo?fileId=${receiptFileId}`}
            alt="收據大圖"
            className="max-h-[85dvh] w-full rounded-2xl object-contain"
          />
        )}
      </DialogContent>
    </Dialog>
    </>
  );
}
