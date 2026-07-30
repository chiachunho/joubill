"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Clock, Loader2, Trash2 } from "lucide-react";
import useSWR from "swr";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { ConfirmDialog } from "@/components/mini/ConfirmDialog";

type DeleteRequestResponse = {
  request: {
    id: number;
    requestedBy: number;
    requestedByName: string;
    createdAt: string;
    expiresAt: string;
  } | null;
};

type Props = {
  groupId: string;
  membersCount: number;
  selfUserId: number | undefined;
  rawFetch: (url: string, init?: RequestInit) => Promise<Response>;
  redirectPath: string;
};

export function DangerZoneSection({
  groupId,
  membersCount,
  selfUserId,
  rawFetch,
  redirectPath,
}: Props) {
  const router = useRouter();

  const {
    data: deleteRequestData,
    mutate: mutateDeleteRequest,
    error: deleteRequestError,
  } = useSWR<DeleteRequestResponse>(`/api/groups/${groupId}/delete-request`, {
    // Only poll while a request is pending; SWR v2 accepts a function here.
    refreshInterval: (data) => (data?.request ? 10_000 : 0),
  });

  const pendingRequest = deleteRequestData?.request ?? null;

  // If polling returns an auth error the group was deleted by someone else — leave the page.
  useEffect(() => {
    if (deleteRequestError) router.replace(redirectPath);
  }, [deleteRequestError, router, redirectPath]);

  const [deleteGroupOpen, setDeleteGroupOpen] = useState(false);
  const [deleteGroupLoading, setDeleteGroupLoading] = useState(false);
  const [deleteGroupError, setDeleteGroupError] = useState<string | null>(null);
  const [approvingDelete, setApprovingDelete] = useState(false);
  const [cancellingDelete, setCancellingDelete] = useState(false);

  async function doDeleteGroup() {
    setDeleteGroupLoading(true);
    setDeleteGroupError(null);
    try {
      const res = await rawFetch(`/api/groups/${groupId}`, { method: "DELETE" });
      if (!res.ok) {
        setDeleteGroupError("刪除失敗，請再試一次");
        return;
      }
      const data = (await res.json()) as { ok?: boolean; pending?: boolean };
      if (data.pending) {
        setDeleteGroupOpen(false);
        await mutateDeleteRequest();
      } else {
        router.replace(redirectPath);
      }
    } catch {
      setDeleteGroupError("刪除失敗，請再試一次");
    } finally {
      setDeleteGroupLoading(false);
    }
  }

  async function approveDeleteRequest() {
    setApprovingDelete(true);
    setDeleteGroupError(null);
    try {
      const res = await rawFetch(`/api/groups/${groupId}/delete-request`, { method: "POST" });
      if (!res.ok) {
        setDeleteGroupError("操作失敗，請再試一次");
        await mutateDeleteRequest();
        return;
      }
      router.replace(redirectPath);
    } catch {
      setDeleteGroupError("操作失敗，請再試一次");
    } finally {
      setApprovingDelete(false);
    }
  }

  async function cancelDeleteRequest() {
    setCancellingDelete(true);
    setDeleteGroupError(null);
    try {
      const res = await rawFetch(`/api/groups/${groupId}/delete-request`, { method: "DELETE" });
      if (!res.ok) setDeleteGroupError("操作失敗，請再試一次");
      await mutateDeleteRequest();
    } catch {
      setDeleteGroupError("操作失敗，請再試一次");
    } finally {
      setCancellingDelete(false);
    }
  }

  return (
    <section className="px-4">
      {pendingRequest && selfUserId !== undefined && <p className="sect mb-2.5">危險區域</p>}

      {pendingRequest && selfUserId !== undefined ? (
        pendingRequest.requestedBy === selfUserId ? (
          <div className="overflow-hidden rounded-2xl bg-secondary/50">
            <div className="flex items-center gap-3 px-4 py-3">
              <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted">
                <Clock className="size-3.5 text-muted-foreground" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">等待其他成員確認</p>
                <p className="text-xs text-muted-foreground">已申請刪除群組</p>
              </div>
              <button
                onClick={cancelDeleteRequest}
                disabled={cancellingDelete}
                className="rounded-lg px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
              >
                {cancellingDelete ? <Loader2 className="size-3.5 animate-spin" /> : "取消申請"}
              </button>
            </div>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-destructive/30 bg-destructive/5">
            <div className="px-4 py-3">
              <p className="text-sm font-medium text-destructive">
                {pendingRequest.requestedByName} 申請刪除此群組
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                同意後所有費用與結算紀錄將永久清除。
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={approveDeleteRequest}
                  disabled={approvingDelete || cancellingDelete}
                  className="flex-1 rounded-lg bg-destructive/10 px-3 py-1.5 text-xs font-medium text-destructive transition-colors hover:bg-destructive/20 disabled:opacity-50"
                >
                  {approvingDelete ? (
                    <Loader2 className="mx-auto size-3.5 animate-spin" />
                  ) : (
                    "同意刪除"
                  )}
                </button>
                <button
                  onClick={cancelDeleteRequest}
                  disabled={approvingDelete || cancellingDelete}
                  className="flex-1 rounded-lg bg-secondary px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
                >
                  {cancellingDelete ? (
                    <Loader2 className="mx-auto size-3.5 animate-spin" />
                  ) : (
                    "拒絕"
                  )}
                </button>
              </div>
            </div>
          </div>
        )
      ) : (
        <Accordion type="single" collapsible>
          <AccordionItem value="danger-zone">
            <AccordionTrigger className="sect">危險區域</AccordionTrigger>
            <AccordionContent>
              <div className="overflow-hidden rounded-2xl bg-secondary/50">
                <button
                  onClick={() => setDeleteGroupOpen(true)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-destructive transition-colors hover:bg-destructive/10"
                >
                  <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-destructive/10">
                    <Trash2 className="size-3.5 text-destructive" />
                  </div>
                  <span className="text-sm font-medium">刪除群組</span>
                </button>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      )}

      {deleteGroupError && <p className="mt-2 text-xs text-destructive">{deleteGroupError}</p>}

      <ConfirmDialog
        open={deleteGroupOpen}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteGroupOpen(false);
            setDeleteGroupError(null);
          }
        }}
        title="刪除群組"
        description={
          membersCount > 1
            ? "群組有多位成員，申請後需要另一位成員確認才會刪除。所有費用與結算紀錄將永久清除。"
            : "確定要刪除此群組嗎？所有費用與結算紀錄將永久清除，此動作無法復原。"
        }
        confirmLabel={membersCount > 1 ? "申請刪除" : "刪除"}
        variant="destructive"
        loading={deleteGroupLoading}
        onConfirm={doDeleteGroup}
      />
    </section>
  );
}
