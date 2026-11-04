"use client";

import { useState } from "react";
import { Link2, Link2Off } from "lucide-react";

import { ConfirmDialog } from "@/components/mini/ConfirmDialog";
import { apiErrorStatus } from "@/lib/api-error";
import { useGetGroupChatQuery, useUnlinkChatMutation } from "@/store/api";

type Props = { groupId: string };

/**
 * The group's Telegram chat: which one it is bound to, and the way to let go of it.
 * Any member may unlink, like every other setting here. The ledger stays; the bot says
 * goodbye and leaves, so re-binding means adding it back and typing `/link`.
 */
export function TelegramChatSection({ groupId }: Props) {
  const { data, refetch } = useGetGroupChatQuery(groupId);
  const [unlinkChat, { isLoading }] = useUnlinkChatMutation();
  const [open, setOpen] = useState(false);
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
    <section className="px-4">
      <p className="sect mb-2.5">Telegram 群組</p>
      {data.linked ? (
        <div className="divide-y divide-border/40 overflow-hidden rounded-2xl bg-secondary/50">
          <div className="flex items-center gap-3 px-4 py-3">
            <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
              <Link2 className="size-3.5 text-primary" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="break-words text-sm font-medium">{data.title ?? "已綁定"}</p>
              <p className="text-xs text-muted-foreground">已綁定，每筆紀錄會在聊天室出現卡片</p>
            </div>
          </div>
          <button
            onClick={() => setOpen(true)}
            className="flex w-full items-center gap-3 px-4 py-3 text-destructive transition-colors hover:bg-destructive/10"
          >
            <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-destructive/10">
              <Link2Off className="size-3.5 text-destructive" />
            </div>
            <span className="text-sm font-medium">解除綁定</span>
          </button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl bg-secondary/50">
          <div className="flex items-center gap-3 px-4 py-3">
            <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted">
              <Link2Off className="size-3.5 text-muted-foreground" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">尚未綁定</p>
              <p className="text-xs text-muted-foreground">
                在 Telegram 群組輸入 /link 邀請碼即可綁定
              </p>
            </div>
          </div>
        </div>
      )}

      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

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
    </section>
  );
}
