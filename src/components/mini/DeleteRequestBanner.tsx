"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2 } from "lucide-react";

import {
  useApproveDeleteRequestMutation,
  useCancelDeleteRequestMutation,
  useGetDeleteRequestQuery,
} from "@/store/api";

/**
 * Someone else's pending 刪除群組 request, shown on the group page. A web group has no
 * chat to carry the 同意 / 拒絕 buttons, so the other members need them in the app, and
 * the settings page is the last place anyone looks. Your own request stays in
 * 群組設定 → 危險區域, where it can be cancelled.
 */
export function DeleteRequestBanner({
  groupId,
  selfUserId,
  redirectPath,
}: {
  groupId: string;
  selfUserId: number | undefined;
  redirectPath: string;
}) {
  const router = useRouter();
  const { data, refetch } = useGetDeleteRequestQuery(groupId, {
    pollingInterval: 60_000,
  });
  const [approve] = useApproveDeleteRequestMutation();
  const [reject] = useCancelDeleteRequestMutation();
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const request = data?.request ?? null;
  if (!request || selfUserId === undefined || request.requestedBy === selfUserId) return null;

  async function act(kind: "approve" | "reject") {
    setBusy(kind);
    setError(null);
    try {
      if (kind === "approve") {
        await approve({ groupId }).unwrap();
        router.replace(redirectPath);
      } else {
        await reject({ groupId }).unwrap();
      }
    } catch {
      setError("操作失敗，請再試一次");
      await refetch();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-4 rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3">
      <div className="flex items-start gap-2.5">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-destructive">
            {request.requestedByName} 申請刪除此群組
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            同意後所有費用與結算紀錄將永久清除。
          </p>
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <button
          onClick={() => act("approve")}
          disabled={busy !== null}
          className="flex-1 rounded-lg bg-destructive/10 px-3 py-1.5 text-xs font-medium text-destructive transition-colors hover:bg-destructive/20 disabled:opacity-50"
        >
          {busy === "approve" ? <Loader2 className="mx-auto size-3.5 animate-spin" /> : "同意刪除"}
        </button>
        <button
          onClick={() => act("reject")}
          disabled={busy !== null}
          className="flex-1 rounded-lg bg-secondary px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
        >
          {busy === "reject" ? <Loader2 className="mx-auto size-3.5 animate-spin" /> : "拒絕"}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </div>
  );
}
