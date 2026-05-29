"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { mutate } from "swr";
import { Calendar as CalendarIcon } from "lucide-react";

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useTelegramBackButton } from "@/lib/use-tg-back-button";
import { SUPPORTED_CURRENCIES, settlementFormSchema, type SettlementFormValues } from "@/lib/zod";

type Member = {
  id: number;
  firstName: string | null;
  lastName?: string | null;
  username: string | null;
};

type Initial = {
  id: number;
  amount: number;
  currency: string;
  settledAt: string;
  from: { userId: number };
  to: { userId: number };
};

type Props = {
  groupId: number;
  defaultCurrency: string;
  members: Member[];
  photos?: Record<number, string | null>;
  initial?: Initial;
};

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dayToNoonUtcIso(d: Date): string {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 12)).toISOString();
}

export function SettlementForm({ groupId, defaultCurrency, members, photos, initial }: Props) {
  const router = useRouter();
  const isEdit = !!initial;

  const backToList = useCallback(() => {
    router.push(`/mini/groups/${groupId}/settlements`);
  }, [router, groupId]);
  useTelegramBackButton(backToList);

  const form = useForm<SettlementFormValues>({
    resolver: zodResolver(settlementFormSchema),
    mode: "onChange",
    defaultValues: {
      fromUserId: initial ? String(initial.from.userId) : "",
      toUserId: initial ? String(initial.to.userId) : "",
      amount: initial ? initial.amount.toFixed(2) : "",
      currency: (initial?.currency ?? defaultCurrency) as SettlementFormValues["currency"],
      settledDate: initial ? new Date(initial.settledAt) : new Date(),
    },
  });

  async function onSubmit(values: SettlementFormValues) {
    const { default: WebApp } = await import("@twa-dev/sdk");
    const body = {
      fromUserId: Number(values.fromUserId),
      toUserId: Number(values.toUserId),
      amount: parseFloat(values.amount),
      currency: values.currency,
      settledAt: dayToNoonUtcIso(values.settledDate),
    };

    const url = isEdit
      ? `/api/groups/${groupId}/settlements/${initial!.id}`
      : `/api/groups/${groupId}/settlements`;
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
    mutate(`/api/groups/${groupId}/settlements`);
    mutate(`/api/groups/${groupId}/balance`);
    router.push(`/mini/groups/${groupId}/settlements`);
  }

  const [deletePending, setDeletePending] = useState(false);
  async function handleDelete() {
    if (!initial) return;
    const { default: WebApp } = await import("@twa-dev/sdk");
    WebApp.showPopup(
      {
        title: "確認刪除",
        message: "這筆還款記錄將被永久刪除。",
        buttons: [
          { id: "cancel", type: "cancel" },
          { id: "delete", type: "destructive", text: "刪除" },
        ],
      },
      async (buttonId?: string) => {
        if (buttonId !== "delete") return;
        setDeletePending(true);
        const res = await fetch(`/api/groups/${groupId}/settlements/${initial.id}`, {
          method: "DELETE",
          headers: { Authorization: `tma ${WebApp.initData}` },
        });
        setDeletePending(false);
        if (!res.ok) {
          WebApp.showAlert("刪除失敗");
          return;
        }
        mutate(`/api/groups/${groupId}/settlements`);
        mutate(`/api/groups/${groupId}/balance`);
        router.push(`/mini/groups/${groupId}/settlements`);
      },
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-5 px-4 py-4">
        {/* Header */}
        <div>
          <h1 className="text-lg font-semibold">{isEdit ? "編輯還款記錄" : "新增還款記錄"}</h1>
          {isEdit && (
            <p className="mt-0.5 text-xs text-muted-foreground">#{initial!.id}</p>
          )}
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

        {form.formState.errors.root && (
          <p className="rounded-xl bg-destructive/10 px-4 py-2.5 text-sm text-destructive">
            {form.formState.errors.root.message}
          </p>
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          <Button
            type="submit"
            disabled={form.formState.isSubmitting || !form.formState.isValid}
            className="flex-1 rounded-xl"
          >
            {form.formState.isSubmitting ? "儲存中…" : "儲存"}
          </Button>
          {isEdit && (
            <Button
              type="button"
              variant="destructive"
              disabled={deletePending}
              className="rounded-xl"
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
