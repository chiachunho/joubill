"use client";

import { useState } from "react";
import { Check, Copy, Link2, Link2Off, Loader2 } from "lucide-react";

import { ConfirmDialog } from "@/components/mini/ConfirmDialog";
import { IconTile } from "@/components/mini/IconTile";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { apiErrorStatus, apiErrorText, describeError } from "@/lib/api-error";
import { formatInviteCode } from "@/lib/invite";
import {
  useGetGroupChatQuery,
  useGetInviteQuery,
  useResetInviteMutation,
  useUnlinkChatMutation,
} from "@/store/api";

type Props = { groupId: string };

/**
 * The `/link` command for this group, ready to paste into the Telegram chat, so binding does not
 * mean a detour through 新增成員 for the code. Only mounted while the how-to dialog is open: the
 * invite is not read until someone asks how to bind. A group with no code yet gets 產生邀請碼
 * (a tap, never a read: whoever presses it is the inviter on record, as in `InviteActions`).
 */
function LinkCommand({ groupId }: { groupId: string }) {
  const { data, error, isFetching, refetch } = useGetInviteQuery(groupId);
  const [resetInvite, { isLoading: issuing }] = useResetInviteMutation();
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [manualCopy, setManualCopy] = useState(false);

  const code = data?.code ?? null;
  const command = code ? `/link ${formatInviteCode(code)}` : null;

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setMessage(null);
      setManualCopy(false);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setManualCopy(true);
      setMessage("無法自動複製，請長按或選取上面的指令複製");
    }
  }

  async function issue() {
    setMessage(null);
    try {
      await resetInvite({ groupId }).unwrap();
    } catch (e) {
      setMessage(apiErrorText(e, "產生失敗"));
    }
  }

  if (!data) {
    if (error && !isFetching) {
      return (
        <div className="text-center">
          <p className="text-sm text-destructive">無法載入邀請碼</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{describeError(error)}</p>
          <Button variant="outline" className="mt-2 w-full rounded-lg" onClick={() => refetch()}>
            重試
          </Button>
        </div>
      );
    }
    return <Skeleton aria-busy="true" aria-label="載入中" className="h-[62px] rounded-lg" />;
  }

  if (!command) {
    return (
      <div className="text-center">
        <p className="text-xs text-muted-foreground">這個群組還沒有邀請碼，產生後就能複製指令</p>
        <Button className="mt-2 w-full rounded-lg" onClick={issue} disabled={issuing}>
          {issuing ? <Loader2 className="size-4 animate-spin" /> : "產生邀請碼"}
        </Button>
        {message && <p className="mt-2 text-xs text-destructive">{message}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 rounded-lg bg-secondary/50 px-3.5 py-3">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">貼到 Telegram 群組</p>
          <p className="num break-all text-base font-semibold">{command}</p>
        </div>
        <button
          onClick={() => copy(command)}
          // Icon only: the check mark is the visible feedback, so the accessible name says 已複製.
          aria-label={copied ? "已複製" : "複製指令"}
          className="ml-auto inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-background/70 transition-colors hover:bg-background"
        >
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        </button>
      </div>
      {manualCopy && (
        <input
          readOnly
          value={command}
          aria-label="要複製的內容"
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          className="num w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
        />
      )}
      {message && <p className="text-xs text-destructive">{message}</p>}
    </div>
  );
}

/**
 * The group's Telegram chat as rows of the group settings card: which chat it is bound to and the
 * way to let go of it, or, when there is none, how to bind one. Returns rows, not a section: the
 * page owns the card and its dividers.
 * Any member may unlink, like every other setting here. The ledger stays; the bot says
 * goodbye and leaves, so re-binding means adding it back and typing `/link`.
 */
export function TelegramChatRow({ groupId }: Props) {
  const { data, refetch } = useGetGroupChatQuery(groupId);
  const [unlinkChat, { isLoading }] = useUnlinkChatMutation();
  const [open, setOpen] = useState(false);
  const [howToOpen, setHowToOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Nothing to say until the read lands: guessing "not linked" would offer /link to a linked group.
  if (!data) return null;

  async function doUnlink() {
    setError(null);
    try {
      await unlinkChat({ groupId }).unwrap();
      setOpen(false);
    } catch (err) {
      // 409: another member got there first. The group is unlinked either way.
      if (apiErrorStatus(err) === 409) {
        setOpen(false);
        await refetch();
      } else {
        setError("解除失敗，請再試一次");
      }
    }
  }

  const name = data.title ? `「${data.title}」` : "這個 Telegram 群組";

  return (
    <>
      {data.linked ? (
        <div className="flex items-center gap-3 px-4 py-3">
          <IconTile icon={Link2} />
          <div className="min-w-0 flex-1">
            <p className="text-sm">Telegram 群組</p>
            <p className="break-words text-xs text-muted-foreground">{data.title ?? "已綁定"}</p>
          </div>
          <button
            onClick={() => setOpen(true)}
            className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs text-destructive transition-colors hover:bg-destructive/10"
          >
            <Link2Off className="size-3.5" />
            解除綁定
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-3 px-4 py-3">
          <IconTile icon={Link2Off} tone="muted" />
          <div className="min-w-0 flex-1">
            <p className="text-sm">Telegram 群組</p>
            <p className="text-xs text-muted-foreground">尚未綁定</p>
          </div>
          <button
            onClick={() => setHowToOpen(true)}
            className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
          >
            如何綁定
          </button>
        </div>
      )}

      {error && <p className="px-4 py-2.5 text-xs text-destructive">{error}</p>}

      <Dialog open={howToOpen} onOpenChange={setHowToOpen}>
        <DialogContent className="max-w-sm rounded-2xl">
          <DialogHeader>
            <DialogTitle>綁定 Telegram 群組</DialogTitle>
            <DialogDescription>
              把揪帳 bot 加進 Telegram
              群組，然後在群組裡貼上下面的指令。綁定後，每筆紀錄都會在聊天室出現卡片。
            </DialogDescription>
          </DialogHeader>
          {howToOpen && <LinkCommand groupId={groupId} />}
          <DialogFooter>
            <Button className="w-full rounded-lg" onClick={() => setHowToOpen(false)}>
              知道了
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setError(null);
        }}
        title={`解除與${name}的綁定？`}
        description={
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>解除後這個群組只在 App 裡使用，之後的新增與修改不會再發到 Telegram。</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>成員、所有紀錄和邀請碼都會保留</li>
              <li>聊天室裡舊的卡片會停止更新，按鈕也不能再用</li>
              <li>bot 會離開那個 Telegram 群組</li>
              <li>要重新綁定：先把 bot 加回聊天室，再輸入 /link 邀請碼</li>
            </ul>
          </div>
        }
        confirmLabel="解除綁定"
        variant="destructive"
        loading={isLoading}
        onConfirm={doUnlink}
      />
    </>
  );
}
