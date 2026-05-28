"use client";

import { useActionState, useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { splitEqual } from "@/lib/money";
import { useTelegramBackButton } from "@/lib/use-tg-back-button";
import { SUPPORTED_CURRENCIES, type SupportedCurrency } from "@/lib/zod";

type Member = { id: number; firstName: string; username: string | null };

type SplitInput = { debtorId: number; amount: number };

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

type ShareType = "equal" | "exact" | "percent";

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

  const computedSplits = useMemo<SplitInput[]>(() => {
    const included = Array.from(participants.entries())
      .filter(([, p]) => p.included)
      .map(([id]) => id);
    if (included.length === 0) return [];

    if (shareType === "equal") {
      const shares = splitEqual(totalAmount, included.length);
      return included.map((id, i) => ({ debtorId: id, amount: shares[i] }));
    }
    if (shareType === "exact") {
      return included.map((id) => ({
        debtorId: id,
        amount: parseFloat(participants.get(id)?.value ?? "0") || 0,
      }));
    }
    // percent: pct/100 * total, then round to cent
    return included.map((id) => {
      const pct = parseFloat(participants.get(id)?.value ?? "0") || 0;
      return { debtorId: id, amount: Math.round((totalAmount * pct) / 100 * 100) / 100 };
    });
  }, [participants, shareType, totalAmount]);

  const splitsSum = computedSplits.reduce((s, x) => s + x.amount, 0);
  const splitsBalanced = Math.abs(splitsSum - totalAmount) < 0.02;
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
        <div className="w-24 space-y-1">
          <Label htmlFor="currency">幣別</Label>
          <select
            id="currency"
            value={currency}
            onChange={(e) => setCurrency(e.target.value as SupportedCurrency)}
            className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-sm"
          >
            {SUPPORTED_CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
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
        <select
          id="payer"
          value={payerId}
          onChange={(e) => setPayerId(Number(e.target.value))}
          className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-sm"
        >
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {label(m)}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        <Label>分帳方式</Label>
        <div className="flex gap-3 text-sm">
          {(["equal", "exact", "percent"] as const).map((m) => (
            <label key={m} className="flex items-center gap-1">
              <input
                type="radio"
                name="share-type"
                value={m}
                checked={shareType === m}
                onChange={() => setShareType(m)}
              />
              {m === "equal" ? "均分" : m === "exact" ? "指定金額" : "比例"}
            </label>
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
                <input
                  type="checkbox"
                  checked={p.included}
                  onChange={() => toggleParticipant(m.id)}
                  className="size-4"
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
              "text-sm tabular-nums " +
              (splitsBalanced ? "text-muted-foreground" : "text-rose-600")
            }
          >
            總計 {splitsSum.toFixed(2)}
            {shareType === "percent" ? "% / 100%" : ` / ${totalAmount.toFixed(2)} ${currency}`}
            {splitsBalanced ? " ✓" : " ✗"}
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
