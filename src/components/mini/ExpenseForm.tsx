"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { useFieldArray, useForm } from "react-hook-form";
import { mutate } from "swr";
import { zodResolver } from "@hookform/resolvers/zod";
import { Calendar as CalendarIcon, Check, X } from "lucide-react";

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
import { computeSplits } from "@/lib/splits";
import { cn } from "@/lib/utils";
import { useTelegramBackButton } from "@/lib/use-tg-back-button";
import {
  SUPPORTED_CURRENCIES,
  expenseFormSchema,
  type ExpenseFormValues,
} from "@/lib/zod";

type Member = { id: number; firstName: string; username: string | null };

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
  /** If present, the form is in edit mode. Absent => create mode. */
  initial?: Initial;
};

function label(m: Member): string {
  return m.username ? "@" + m.username : m.firstName;
}

/** Local Y-M-D label for the date trigger (avoids UTC off-by-one). */
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Serialise a picked calendar day as noon UTC so the day never shifts across timezones. */
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
  const { groupId, members, initial } = props;
  const router = useRouter();
  const isEdit = !!initial;

  const backToGroup = useCallback(() => {
    router.push(`/mini/groups/${groupId}`);
  }, [router, groupId]);
  useTelegramBackButton(backToGroup);

  const form = useForm<ExpenseFormValues>({
    resolver: zodResolver(expenseFormSchema),
    defaultValues: buildDefaults(props),
    mode: "onChange",
  });
  const { fields } = useFieldArray({ control: form.control, name: "participants" });

  // Live values for the computed split preview + balance indicator.
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

  async function onSubmit(values: ExpenseFormValues) {
    const { default: WebApp } = await import("@twa-dev/sdk");
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
    const res = await fetch(url, {
      method: isEdit ? "PATCH" : "POST",
      headers: { Authorization: `tma ${WebApp.initData}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const parsed = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      form.setError("root", { message: parsed.error ?? `HTTP ${res.status}` });
      return;
    }
    mutate(`/api/groups/${groupId}/expenses`);
    mutate(`/api/groups/${groupId}/balance`);
    mutate(`/api/groups/${groupId}/stats`);
    router.push(`/mini/groups/${groupId}`);
  }

  const [deletePending, setDeletePending] = useState(false);
  async function handleDelete() {
    if (!initial) return;
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
        if (!res.ok) {
          WebApp.showAlert("刪除失敗");
          return;
        }
        mutate(`/api/groups/${groupId}/expenses`);
        mutate(`/api/groups/${groupId}/balance`);
        mutate(`/api/groups/${groupId}/stats`);
        router.push(`/mini/groups/${groupId}`);
      },
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
        <h1 className="text-xl font-bold">{isEdit ? `編輯支出 #${initial!.id}` : "新增支出"}</h1>

        <div className="flex gap-2">
          <FormField
            control={form.control}
            name="amount"
            render={({ field }) => (
              <FormItem className="flex-1">
                <FormLabel>金額</FormLabel>
                <FormControl>
                  <Input type="number" step="0.01" min="0" inputMode="decimal" {...field} />
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

        <FormField
          control={form.control}
          name="payerId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>付款人</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {members.map((m) => (
                    <SelectItem key={m.id} value={String(m.id)}>
                      {label(m)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="shareType"
          render={({ field }) => (
            <FormItem>
              <FormLabel>分帳方式</FormLabel>
              <div className="inline-flex w-full rounded-md border border-input p-0.5">
                {(["equal", "exact", "percent"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => field.onChange(m)}
                    aria-pressed={field.value === m}
                    className={cn(
                      "flex-1 rounded-[5px] px-3 py-1 text-sm transition-colors",
                      field.value === m
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {m === "equal" ? "均分" : m === "exact" ? "指定金額" : "比例"}
                  </button>
                ))}
              </div>
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="participants"
          render={() => (
            <FormItem>
              <FormLabel>參與者</FormLabel>
              <ul className="flex flex-col gap-2">
                {fields.map((f, i) => {
                  const m = members.find((x) => x.id === f.userId);
                  const isIncluded = participants[i]?.included ?? false;
                  const computed = computedSplits.find((x) => x.debtorId === f.userId);
                  return (
                    <li key={f.id} className="flex items-center gap-2">
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
                      <span className="flex-1 text-sm">{m ? label(m) : `#${f.userId}`}</span>
                      {shareType === "equal" ? (
                        <Input
                          disabled
                          className="w-24 text-right tabular-nums"
                          value={isIncluded && computed ? computed.amount.toFixed(2) : ""}
                        />
                      ) : (
                        <FormField
                          control={form.control}
                          name={`participants.${i}.value`}
                          render={({ field }) => (
                            <Input
                              type="number"
                              step="0.01"
                              min="0"
                              inputMode="decimal"
                              className="w-24 text-right tabular-nums"
                              placeholder={shareType === "percent" ? "%" : ""}
                              disabled={!isIncluded}
                              {...field}
                            />
                          )}
                        />
                      )}
                    </li>
                  );
                })}
              </ul>
              {shareType !== "equal" && (
                <p
                  className={cn(
                    "flex items-center gap-1 text-sm tabular-nums",
                    splitsBalanced ? "text-muted-foreground" : "text-rose-600",
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
          <p className="text-sm text-destructive">{form.formState.errors.root.message}</p>
        )}

        <div className="flex gap-2 pt-2">
          <Button type="submit" disabled={form.formState.isSubmitting} className="flex-1">
            {form.formState.isSubmitting ? "儲存中…" : "儲存"}
          </Button>
          {isEdit && (
            <Button
              type="button"
              variant="destructive"
              disabled={deletePending}
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
