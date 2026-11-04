"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Clock, Loader2, Trash2 } from "lucide-react";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { ConfirmDialog } from "@/components/mini/ConfirmDialog";
import {
  useApproveDeleteRequestMutation,
  useCancelDeleteRequestMutation,
  useDeleteGroupMutation,
  useGetDeleteRequestQuery,
} from "@/store/api";

type Props = {
  groupId: string;
  membersCount: number;
  selfUserId: number | undefined;
  redirectPath: string;
};

export function DangerZoneSection({ groupId, membersCount, selfUserId, redirectPath }: Props) {
  const router = useRouter();

  // Poll only while a request is pending, so the others' approval shows up without a reload.
  const [polling, setPolling] = useState(false);
  const {
    data: deleteRequestData,
    error: deleteRequestError,
    refetch: refetchDeleteRequest,
  } = useGetDeleteRequestQuery(groupId, { pollingInterval: polling ? 10_000 : 0 });
  const [deleteGroup] = useDeleteGroupMutation();
  const [approveDeleteRequestMutation] = useApproveDeleteRequestMutation();
  const [cancelDeleteRequestMutation] = useCancelDeleteRequestMutation();

  const pendingRequest = deleteRequestData?.request ?? null;
  // `polling` feeds the query that produces `pendingRequest`, so it can't simply be derived
  // above the hook; follow it while rendering instead.
  if (polling !== (pendingRequest !== null)) setPolling(pendingRequest !== null);
  // `pendingRequest` and `selfUserId` come from two independent, unordered
  // fetches. Until both have resolved we can't yet tell whether there's an
  // actionable pending request, so we must not fall through to the collapsed
  // idle accordion — that would hide a real pending request behind a tap.
  const dangerZoneLoading =
    deleteRequestData === undefined || (pendingRequest !== null && selfUserId === undefined);

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
      const data = await deleteGroup({ groupId }).unwrap();
      if (data.pending) {
        // Waiting on the others: the request now shows in this section.
        setDeleteGroupOpen(false);
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
      await approveDeleteRequestMutation({ groupId }).unwrap();
      router.replace(redirectPath);
    } catch {
      setDeleteGroupError("操作失敗，請再試一次");
      await refetchDeleteRequest();
    } finally {
      setApprovingDelete(false);
    }
  }

  async function cancelDeleteRequest() {
    setCancellingDelete(true);
    setDeleteGroupError(null);
    try {
      await cancelDeleteRequestMutation({ groupId }).unwrap();
    } catch {
      setDeleteGroupError("操作失敗，請再試一次");
      await refetchDeleteRequest();
    } finally {
      setCancellingDelete(false);
    }
  }

  return (
    <section className="px-4">
      {(dangerZoneLoading || pendingRequest) && <p className="sect mb-2.5">危險區域</p>}

      {dangerZoneLoading ? (
        <div className="overflow-hidden rounded-2xl bg-secondary/50">
          <div className="flex items-center gap-3 px-4 py-3">
            <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">載入中…</p>
          </div>
        </div>
      ) : pendingRequest ? (
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
