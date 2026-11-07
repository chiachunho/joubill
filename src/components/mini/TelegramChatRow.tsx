"use client";

import { useState } from "react";
import { Link2, Link2Off } from "lucide-react";

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
import { apiErrorStatus } from "@/lib/api-error";
import { useGetGroupChatQuery, useUnlinkChatMutation } from "@/store/api";

type Props = { groupId: string };

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
              把揪帳 bot 加進 Telegram 群組，然後在群組裡輸入 /link
              邀請碼。邀請碼可以在「新增成員」裡取得。綁定後，每筆紀錄都會在聊天室出現卡片。
            </DialogDescription>
          </DialogHeader>
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
