"use client";

import { useState } from "react";
import { Check, Copy, Hash, Link2Off, Loader2 } from "lucide-react";

import { ConfirmDialog } from "@/components/mini/ConfirmDialog";
import { IconTile } from "@/components/mini/IconTile";
import { TelegramGlyph } from "@/components/TelegramIcon";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { apiErrorStatus, apiErrorText, describeError } from "@/lib/api-error";
import type { GroupChatResponse } from "@/lib/api-types";
import { formatInviteCode } from "@/lib/invite";
import { NOTICE_THREAD_PURPOSE, topicName } from "@/lib/topic-text";
import {
  useGetInviteQuery,
  useResetInviteMutation,
  useResetNoticeThreadMutation,
  useUnlinkChatMutation,
} from "@/store/api";

/**
 * A command to paste into Telegram, with a copy button. When the clipboard is refused, the
 * command is put in a selected field to copy by hand.
 */
function CopyCommand({ command, label }: { command: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const [manualCopy, setManualCopy] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setManualCopy(false);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setManualCopy(true);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 rounded-lg bg-secondary/50 px-3.5 py-3">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="num break-all text-base font-semibold">{command}</p>
        </div>
        <button
          onClick={copy}
          // Icon only: the check mark is the visible feedback, so the accessible name says 已複製.
          aria-label={copied ? "已複製" : "複製指令"}
          className="ml-auto inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-background/70 transition-colors hover:bg-background"
        >
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        </button>
      </div>
      {manualCopy && (
        <>
          <input
            readOnly
            value={command}
            aria-label="要複製的內容"
            autoFocus
            onFocus={(e) => e.currentTarget.select()}
            className="num w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
          />
          <p className="text-xs text-destructive">無法自動複製，請長按或選取上面的指令複製</p>
        </>
      )}
    </div>
  );
}

/**
 * The `/link` command for this group, ready to paste into the Telegram chat. A group with no code
 * yet gets 產生邀請碼 (a tap, never a read: whoever presses it is the inviter on record, as in
 * `InviteActions`).
 */
function LinkCommand({ groupId }: { groupId: string }) {
  const { data, error, isFetching, refetch } = useGetInviteQuery(groupId);
  const [resetInvite, { isLoading: issuing }] = useResetInviteMutation();
  const [message, setMessage] = useState<string | null>(null);

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

  if (!data.code) {
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
    <CopyCommand command={`/link ${formatInviteCode(data.code)}`} label="貼到 Telegram 群組" />
  );
}

/**
 * The body of the Telegram 群組 page: which chat the group is bound to and the way to let go of
 * it, the topic its notices go to (記帳通知發送位置), or, when there is no chat, how to bind one.
 * Any member may change any of it, like every other group setting.
 */
export function TelegramChatSettings({
  groupId,
  chat,
  onUnlinkConflict,
}: {
  groupId: string;
  chat: GroupChatResponse;
  /** Another member unlinked first (409): reread the chat, which shows the group unbound. */
  onUnlinkConflict: () => void;
}) {
  const [unlinkChat, { isLoading: unlinking }] = useUnlinkChatMutation();
  const [resetNoticeThread, { isLoading: resetting }] = useResetNoticeThreadMutation();
  const [unlinkOpen, setUnlinkOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function doUnlink() {
    setError(null);
    try {
      await unlinkChat({ groupId }).unwrap();
      setUnlinkOpen(false);
    } catch (err) {
      // 409: another member got there first. The group is unlinked either way.
      if (apiErrorStatus(err) === 409) {
        setUnlinkOpen(false);
        onUnlinkConflict();
      } else {
        setError("解除失敗，請再試一次");
      }
    }
  }

  async function doReset() {
    setError(null);
    try {
      await resetNoticeThread({ groupId }).unwrap();
      setResetOpen(false);
    } catch {
      setError("變更失敗，請再試一次");
    }
  }

  if (!chat.linked) {
    return (
      <>
        <section className="px-4">
          <div className="overflow-hidden rounded-2xl bg-secondary/50">
            <div className="flex items-center gap-3 px-4 py-3">
              <IconTile icon={Link2Off} tone="muted" />
              <div className="min-w-0 flex-1">
                <p className="text-sm">尚未綁定</p>
                <p className="text-xs text-muted-foreground">這個群組目前只在 App 裡使用</p>
              </div>
            </div>
          </div>
        </section>
        <section className="space-y-2.5 px-4">
          <p className="sect">如何綁定</p>
          <ol className="list-decimal space-y-0.5 pl-5 text-sm text-muted-foreground">
            <li>把揪帳 bot 加進 Telegram 群組</li>
            <li>在群組裡貼上下面的指令</li>
          </ol>
          <LinkCommand groupId={groupId} />
          <p className="text-xs text-muted-foreground">綁定後，每筆紀錄都會在聊天室出現卡片。</p>
        </section>
      </>
    );
  }

  const name = chat.title ? `「${chat.title}」` : "這個 Telegram 群組";
  const thread = chat.noticeThread;
  // A setting left from before topics were switched off still shows, so it can be cleared.
  const showTopic = chat.isForum === true || thread !== null;

  return (
    <>
      <section className="space-y-2 px-4">
        <div className="overflow-hidden rounded-2xl bg-secondary/50">
          <div className="flex items-center gap-3 px-4 py-3">
            <IconTile icon={TelegramGlyph} />
            <div className="min-w-0 flex-1">
              <p className="text-sm">已綁定</p>
              <p className="break-words text-xs text-muted-foreground">
                {chat.title ?? "Telegram 群組"}
              </p>
            </div>
            <button
              onClick={() => setUnlinkOpen(true)}
              className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs text-destructive transition-colors hover:bg-destructive/10"
            >
              <Link2Off className="size-3.5" />
              解除綁定
            </button>
          </div>
        </div>
        <p className="px-1 text-xs leading-relaxed text-muted-foreground">
          每筆紀錄都會在聊天室出現卡片，在 App 修改或刪除時會同步更新。
          {chat.isForum === false &&
            thread === null &&
            "在 Telegram 開啟群組的「主題」功能後，可以設定記帳通知發送位置。"}
        </p>
      </section>

      {showTopic && (
        <section className="space-y-2 px-4">
          <p className="sect">記帳通知發送位置</p>
          <div className="overflow-hidden rounded-2xl bg-secondary/50">
            <div className="flex items-center gap-3 px-4 py-3">
              <IconTile icon={Hash} tone={thread ? "primary" : "muted"} />
              <p className="min-w-0 flex-1 break-words text-sm">
                {thread ? topicName(thread.name) : "General"}
              </p>
              {thread && (
                <button
                  onClick={() => setResetOpen(true)}
                  className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
                >
                  改回 General
                </button>
              )}
            </div>
          </div>
          <p className="px-1 text-xs leading-relaxed text-muted-foreground">
            {thread ? "目前發到這個主題。" : "目前發在群組預設的 General。"}
            {NOTICE_THREAD_PURPOSE}
            要換主題，到 Telegram 群組裡想要的主題貼上下面的指令，再按 bot 回覆裡的按鈕。
          </p>
          <CopyCommand command="/topic" label="貼到想要的主題" />
        </section>
      )}

      {error && <p className="px-4 text-xs text-destructive">{error}</p>}

      <ConfirmDialog
        open={unlinkOpen}
        onOpenChange={(next) => {
          setUnlinkOpen(next);
          if (!next) setError(null);
        }}
        title={`解除與${name}的綁定？`}
        description={
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>解除後這個群組只在 App 裡使用，之後的新增與修改不會再發到 Telegram。</p>
            <ul className="list-disc space-y-1 pl-5 text-left">
              <li>成員、所有紀錄和邀請碼都會保留</li>
              <li>聊天室裡舊的卡片會停止更新，按鈕也不能再用</li>
              <li>bot 會離開那個 Telegram 群組</li>
              <li>要重新綁定：先把 bot 加回聊天室，再輸入 /link 邀請碼</li>
            </ul>
          </div>
        }
        confirmLabel="解除綁定"
        variant="destructive"
        loading={unlinking}
        onConfirm={doUnlink}
      />

      <ConfirmDialog
        open={resetOpen}
        onOpenChange={(next) => {
          setResetOpen(next);
          if (!next) setError(null);
        }}
        title="改回 General？"
        description={
          thread
            ? `之後的記帳通知會發在群組的 General。已經發在「${topicName(thread.name)}」的卡片會留在原處，照常更新。`
            : undefined
        }
        confirmLabel="改回 General"
        loading={resetting}
        onConfirm={doReset}
      />
    </>
  );
}
