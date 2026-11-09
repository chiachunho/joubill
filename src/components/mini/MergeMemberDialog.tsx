"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

import { Avatar } from "@/components/mini/Avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiErrorText } from "@/lib/api-error";
import type { Member } from "@/lib/api-types";
import { labelUser } from "@/lib/label";
import { fmtGrouped } from "@/lib/money";
import { useGetMergePreviewQuery, useMergeMemberMutation } from "@/store/api";

/**
 * 合併到…: fold a 無帳號 member into a real one. Irreversible and needs nobody's approval
 * (a decision, see docs/architecture/groups-and-members.md), so the dialog says how many records move and the balance they
 * carry before the confirm button is enabled.
 */
export function MergeMemberDialog({
  groupId,
  placeholder,
  members,
  selfUserId,
  photos,
  onOpenChange,
}: {
  groupId: string;
  /** The member being merged away; the dialog is open while this is set. */
  placeholder: Member | null;
  members: Member[];
  selfUserId?: number;
  photos?: Record<number, string | null>;
  onOpenChange: (open: boolean) => void;
}) {
  const candidates = members.filter((m) => !m.isPlaceholder);
  const [picked, setPicked] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Only asked when the two people have settlements with each other. Keeping is the
  // non-destructive default; those records can then only be deleted, never edited.
  const [selfChoice, setSelfChoice] = useState<"delete" | "keep">("keep");
  const [merge, { isLoading }] = useMergeMemberMutation();

  // Preselect the viewer: claiming a name for yourself is the common case.
  const target = picked ?? (candidates.some((m) => m.id === selfUserId) ? selfUserId! : null);

  const { currentData: preview, isFetching } = useGetMergePreviewQuery(
    { groupId, userId: placeholder?.id ?? 0, intoUserId: target ?? 0 },
    { skip: !placeholder || target === null },
  );

  const name = (m: Member) =>
    labelUser({
      userId: m.id,
      displayName: m.displayName,
      firstName: m.firstName,
      lastName: m.lastName,
      username: m.username,
    });
  const targetMember = candidates.find((m) => m.id === target);
  const records = preview ? preview.expenses + preview.settlements : 0;

  function close(open: boolean) {
    if (isLoading) return;
    if (!open) {
      setPicked(null);
      setError(null);
      setSelfChoice("keep");
    }
    onOpenChange(open);
  }

  async function confirm() {
    if (!placeholder || target === null) return;
    setError(null);
    try {
      await merge({
        groupId,
        userId: placeholder.id,
        intoUserId: target,
        selfSettlements: preview && preview.selfSettlements > 0 ? selfChoice : undefined,
      }).unwrap();
      close(false);
    } catch (e) {
      setError(apiErrorText(e, "合併失敗，請再試一次"));
    }
  }

  return (
    <Dialog open={placeholder !== null} onOpenChange={close}>
      <DialogContent className="max-w-sm rounded-2xl">
        <DialogHeader>
          <DialogTitle>把「{placeholder ? name(placeholder) : ""}」合併到…</DialogTitle>
          <DialogDescription>選一位真實成員。他的所有紀錄會改記在對方名下。</DialogDescription>
        </DialogHeader>

        <fieldset className="flex flex-col gap-2">
          <legend className="sr-only">合併到哪位成員</legend>
          {candidates.map((m) => (
            <label
              key={m.id}
              className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border px-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5"
            >
              <input
                type="radio"
                name="merge-target"
                checked={target === m.id}
                onChange={() => setPicked(m.id)}
                disabled={isLoading}
              />
              <Avatar src={photos?.[m.id] ?? null} name={name(m)} userId={m.id} size="sm" />
              {name(m)}
              {m.id === selfUserId && <span className="text-muted-foreground">（你）</span>}
            </label>
          ))}
        </fieldset>

        {targetMember && (
          <div className="rounded-lg bg-secondary/60 px-3.5 py-3 text-sm">
            {isFetching || !preview ? (
              <span className="text-muted-foreground">計算中…</span>
            ) : records === 0 ? (
              <span>他還沒有任何紀錄，只會移除這個名字。</span>
            ) : (
              <div className="flex flex-col gap-1.5">
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">帶走的紀錄</span>
                  <span className="font-semibold">
                    {records} 筆（{preview.expenses} 支出 · {preview.settlements} 還款）
                  </span>
                </div>
                {Object.entries(preview.net).map(([currency, amount]) => (
                  <div key={currency} className="flex justify-between gap-3">
                    <span className="text-muted-foreground">帶走的餘額</span>
                    <span className="num font-semibold">
                      {amount > 0 ? "+" : ""}
                      {fmtGrouped(amount)} {currency}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {preview && preview.selfSettlements > 0 && (
          <fieldset className="flex flex-col gap-2 text-sm">
            <legend className="mb-1 font-medium">
              有 {preview.selfSettlements} 筆還款是他和 {targetMember ? name(targetMember) : "對方"}{" "}
              之間的，合併後會變成自己還自己
            </legend>
            <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border px-3 py-2 has-[:checked]:border-primary has-[:checked]:bg-primary/5">
              <input
                type="radio"
                name="self-settlements"
                className="mt-1"
                checked={selfChoice === "keep"}
                onChange={() => setSelfChoice("keep")}
                disabled={isLoading}
              />
              <span>
                保留這些還款
                <span className="block text-xs text-muted-foreground">
                  之後不能再編輯，只能刪除。
                </span>
              </span>
            </label>
            <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border px-3 py-2 has-[:checked]:border-primary has-[:checked]:bg-primary/5">
              <input
                type="radio"
                name="self-settlements"
                className="mt-1"
                checked={selfChoice === "delete"}
                onChange={() => setSelfChoice("delete")}
                disabled={isLoading}
              />
              <span>
                一併刪除這些還款
                <span className="block text-xs text-muted-foreground">
                  不影響餘額，動態紀錄和群組訊息會留下刪除紀錄。
                </span>
              </span>
            </label>
          </fieldset>
        )}

        <p className="rounded-lg bg-destructive/10 px-3.5 py-2.5 text-sm text-destructive">
          合併後無法還原，也不需要其他成員同意。
        </p>
        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter className="flex-row gap-2">
          <Button
            variant="outline"
            className="flex-1 rounded-lg"
            onClick={() => close(false)}
            disabled={isLoading}
          >
            取消
          </Button>
          <Button
            variant="destructive"
            className="flex-1 rounded-lg"
            onClick={confirm}
            disabled={isLoading || !targetMember || !preview || isFetching}
          >
            {isLoading ? <Loader2 className="size-4 animate-spin" /> : "確認合併"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
