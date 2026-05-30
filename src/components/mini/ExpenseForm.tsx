"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { useFieldArray, useForm } from "react-hook-form";
import { mutate } from "swr";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, Calendar as CalendarIcon, Check, X } from "lucide-react";

import { Avatar } from "@/components/mini/Avatar";
import { MemberSelect } from "@/components/mini/MemberSelect";
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
import { webRawFetch } from "@/lib/web-fetch";
import {
  SUPPORTED_CURRENCIES,
  expenseFormSchema,
  type ExpenseFormValues,
} from "@/lib/zod";

type Member = { id: number; firstName: string; lastName?: string | null; username: string | null };

type Initial = {
  id: number;
  amount: number;
  currency: string;
  description: string | null;
  payerId: number;
  spentAt: string;
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
        included: initial ? split !== undefined : true,
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

    let res: Response;
    if (mode === "web") {
      res = await webRawFetch(url, {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } else {
      const { default: WebApp } = await import("@twa-dev/sdk");
      res = await fetch(url, {
        method: isEdit ? "PATCH" : "POST",
        headers: { Authorization: `tma ${WebApp.initData}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    }

    if (!res.ok) {
      const parsed = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      form.setError("root", { message: parsed.error ?? `HTTP ${res.status}` });
      return;
    }
    revalidateGroup();
    router.push(back);
  }

  const [deletePending, setDeletePending] = useState(false);
  async function handleDelete() {
    if (!initial) return;
    if (mode === "web") {
      if (!window.confirm("確定要刪除這筆支出嗎？")) return;
      setDeletePending(true);
      const res = await webRawFetch(`/api/groups/${groupId}/expenses/${initial.id}`, {
        method: "DELETE",
      });
      setDeletePending(false);
      if (!res.ok) { window.alert("刪除失敗"); return; }
      revalidateGroup();
      router.push(back);
      return;
    }
    const { default: WebApp } = await import("@twa-dev/sdk");
    WebApp.showPopup(
      {
        title: "確認刪除",
        message: "這筆支出將被永久刪除。",
        buttons: [
          { id: "cancel", type: "cancel" },
          { id: "delete", type: "destructive", text: "刪除" },
        ],
      },
      async (buttonId?: string) => {
        if (buttonId !== "delete") return;
        setDeletePending(true);
        const res = await fetch(`/api/groups/${groupId}/expenses/${initial.id}`, {
          method: "DELETE",
          headers: { Authorization: `tma ${WebApp.initData}` },
        });
        setDeletePending(false);
        if (!res.ok) { WebApp.showAlert("刪除失敗"); return; }
        revalidateGroup();
        router.push(back);
      },
    );
  }

  return (
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
              onClick={handleDelete}
            >
              {deletePending ? "刪除中…" : "刪除"}
            </Button>
          )}
        </div>
      </form>
    </Form>
  );
}
