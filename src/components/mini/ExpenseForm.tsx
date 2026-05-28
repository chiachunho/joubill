"use client";

import { useActionState, useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { computeSplits, type ShareType } from "@/lib/splits";
import { cn } from "@/lib/utils";
import { useTelegramBackButton } from "@/lib/use-tg-back-button";
import { SUPPORTED_CURRENCIES, type SupportedCurrency } from "@/lib/zod";

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

function todayISODate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function ExpenseForm({
  groupId,
  defaultCurrency,
  currentUserId,
  members,
  initial,
}: Props) {
  const router = useRouter();
  const isEdit = !!initial;

  const backToGroup = useCallback(() => {
    router.push(`/mini/groups/${groupId}`);
  }, [router, groupId]);
  useTelegramBackButton(backToGroup);

  const [amount, setAmount] = useState(initial ? initial.amount.toFixed(2) : "");
  const [currency, setCurrency] = useState<string>(initial?.currency ?? defaultCurrency);
  const [description, setDescription] = useState(initial?.description ?? "");
  const [payerId, setPayerId] = useState<number>(initial?.payerId ?? currentUserId);
  const [spentAt, setSpentAt] = useState(
    initial ? new Date(initial.spentAt).toISOString().slice(0, 10) : todayISODate(),
  );

  const initialShareType: ShareType =
    initial?.splits[0]?.shareType === "exact" ||
    initial?.splits[0]?.shareType === "percent"
      ? (initial.splits[0].shareType as ShareType)
      : "equal";
  const [shareType, setShareType] = useState<ShareType>(initialShareType);

  /** memberId -> { included, raw input value for exact/percent mode } */
  const [participants, setParticipants] = useState<Map<number, { included: boolean; value: string }>>(() => {
    const map = new Map<number, { included: boolean; value: string }>();
    if (initial) {
      const splitByDebtor = new Map(initial.splits.map((s) => [s.debtorId, s.amount]));
      for (const m of members) {
        const split = splitByDebtor.get(m.id);
        map.set(m.id, {
          included: split !== undefined,
          value: split !== undefined ? split.toFixed(2) : "",
        });
      }
    } else {
      // New expense: include everyone in equal mode by default.
      for (const m of members) {
        map.set(m.id, { included: true, value: "" });
      }
    }
    return map;
  });

  const toggleParticipant = useCallback((id: number) => {
    setParticipants((prev) => {
      const next = new Map(prev);
      const cur = next.get(id) ?? { included: false, value: "" };
      next.set(id, { ...cur, included: !cur.included });
      return next;
    });
  }, []);

  const setParticipantValue = useCallback((id: number, value: string) => {
    setParticipants((prev) => {
      const next = new Map(prev);
      const cur = next.get(id) ?? { included: false, value: "" };
      next.set(id, { ...cur, value });
      return next;
    });
  }, []);

  const totalAmount = parseFloat(amount) || 0;

  const computedSplits = useMemo(() => {
    const included = members
      .filter((m) => participants.get(m.id)?.included)
      .map((m) => ({ userId: m.id, value: participants.get(m.id)?.value }));
    return computeSplits(totalAmount, shareType, included);
  }, [members, participants, shareType, totalAmount]);

  // Sum of the raw inputs the user typed: percentages in percent mode,
  // currency amounts in exact mode. Used for the live total indicator.
  const inputSum = members.reduce((sum, m) => {
    const p = participants.get(m.id);
    if (!p?.included) return sum;
    return sum + (parseFloat(p.value ?? "0") || 0);
  }, 0);

  const splitsBalanced =
    shareType === "percent"
      ? Math.abs(inputSum - 100) < 0.1
      : Math.abs(inputSum - totalAmount) < 0.02;
  const splitsValid = computedSplits.length > 0 && (shareType === "equal" || splitsBalanced);

  const [state, formAction, pending] = useActionState(
    async (_prev: { error: string } | null) => {
      if (totalAmount <= 0) return { error: "請輸入有效的金額" };
      if (!splitsValid) {
        return { error: shareType === "percent" ? "比例加總需為 100%" : "分帳金額加總與總金額不符" };
      }

      const { default: WebApp } = await import("@twa-dev/sdk");
      const body = {
        amount: totalAmount,
        currency,
        description: description.trim() || null,
        payerId,
        spentAt: new Date(spentAt + "T12:00:00").toISOString(),
        shareType,
        splits: computedSplits,
      };

      const url = isEdit
        ? `/api/groups/${groupId}/expenses/${initial!.id}`
        : `/api/groups/${groupId}/expenses`;
      const res = await fetch(url, {
        method: isEdit ? "PATCH" : "POST",
        headers: {
          Authorization: `tma ${WebApp.initData}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const parsed = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        return { error: parsed.error ?? `HTTP ${res.status}` };
      }
      router.push(`/mini/groups/${groupId}`);
      router.refresh();
      return null;
    },
    null,
  );

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
        router.push(`/mini/groups/${groupId}`);
        router.refresh();
      },
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <h1 className="text-xl font-bold">{isEdit ? `編輯支出 #${initial!.id}` : "新增支出"}</h1>

      <div className="flex gap-2">
        <div className="flex-1 space-y-1">
          <Label htmlFor="amount">金額</Label>
          <Input
            id="amount"
            type="number"
            step="0.01"
            min="0"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
          />
        </div>
        <div className="w-28 space-y-1">
          <Label htmlFor="currency">幣別</Label>
          <Select value={currency} onValueChange={(v) => setCurrency(v as SupportedCurrency)}>
            <SelectTrigger id="currency">
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

      <div className="space-y-1">
        <Label htmlFor="spent_at">日期</Label>
        <Input
          id="spent_at"
          type="date"
          value={spentAt}
          onChange={(e) => setSpentAt(e.target.value)}
          required
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="description">說明</Label>
        <Input
          id="description"
          value={description ?? ""}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="例如：晚餐、機票"
          maxLength={500}
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="payer">付款人</Label>
        <Select value={String(payerId)} onValueChange={(v) => setPayerId(Number(v))}>
          <SelectTrigger id="payer">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {members.map((m) => (
              <SelectItem key={m.id} value={String(m.id)}>
                {label(m)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label>分帳方式</Label>
        <div className="inline-flex w-full rounded-md border border-input p-0.5">
          {(["equal", "exact", "percent"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setShareType(m)}
              aria-pressed={shareType === m}
              className={cn(
                "flex-1 rounded-[5px] px-3 py-1 text-sm transition-colors",
                shareType === m
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {m === "equal" ? "均分" : m === "exact" ? "指定金額" : "比例"}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <Label>參與者</Label>
        <ul className="flex flex-col gap-2">
          {members.map((m) => {
            const p = participants.get(m.id) ?? { included: false, value: "" };
            const computed = computedSplits.find((x) => x.debtorId === m.id);
            return (
              <li key={m.id} className="flex items-center gap-2">
                <Checkbox
                  checked={p.included}
                  onCheckedChange={() => toggleParticipant(m.id)}
                />
                <span className="flex-1 text-sm">{label(m)}</span>
                {shareType === "equal" ? (
                  <span className="w-24 text-right text-sm tabular-nums text-muted-foreground">
                    {p.included && computed ? computed.amount.toFixed(2) : ""}
                  </span>
                ) : (
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    inputMode="decimal"
                    className="w-24"
                    value={p.value}
                    onChange={(e) => setParticipantValue(m.id, e.target.value)}
                    disabled={!p.included}
                    placeholder={shareType === "percent" ? "%" : ""}
                  />
                )}
              </li>
            );
          })}
        </ul>
        {shareType !== "equal" && (
          <p
            className={
              "flex items-center gap-1 text-sm tabular-nums " +
              (splitsBalanced ? "text-muted-foreground" : "text-rose-600")
            }
          >
            {shareType === "percent"
              ? `總計 ${inputSum.toFixed(2)}% / 100%`
              : `總計 ${inputSum.toFixed(2)} / ${totalAmount.toFixed(2)} ${currency}`}
            {splitsBalanced ? (
              <Check className="size-3.5" />
            ) : (
              <X className="size-3.5" />
            )}
          </p>
        )}
      </div>

      {state?.error && <p className="text-sm text-rose-600">{state.error}</p>}

      <div className="flex gap-2 pt-2">
        <Button type="submit" disabled={pending || !splitsValid} className="flex-1">
          {pending ? "儲存中…" : "儲存"}
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
  );
}
