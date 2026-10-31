"use client";

import { useState } from "react";
import { Check, Copy, KeyRound, Loader2, RefreshCw, Share2 } from "lucide-react";

import { ConfirmDialog } from "@/components/mini/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { apiErrorText, describeError } from "@/lib/api-error";
import { cn } from "@/lib/utils";
import { formatInviteCode, inviteLink } from "@/lib/invite";
import { useGetInviteQuery, useResetInviteMutation } from "@/store/api";

type CopyKind = "link" | "mini" | "code";

// Buttons sit on the dialog's own background, so they take the panel surface to be seen;
// the one inside the code box (already that surface) takes the background instead.
const ACTION =
  "inline-flex min-w-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm transition-colors";
const ON_DIALOG = "bg-secondary/70 hover:bg-secondary";
const ON_PANEL = "bg-background/70 hover:bg-background";

/**
 * The invite step of 新增成員 (`AddMemberDialog`): the live code, a copy / share row per
 * kind of link, and 重設邀請碼 behind a confirm.
 *
 * Whether a code exists decides whether the buttons render at all. Loading, a failed read
 * and a group with no code yet show no copy or share button, disabled or otherwise, so the
 * panel never shows a row of buttons that then disappears. A missing code is only issued by
 * a tap on 產生邀請碼, never on read: whoever presses it is the inviter on record.
 */
export function InviteActions({ groupId, hint }: { groupId: string; hint: string }) {
  const { data, error, isFetching, refetch } = useGetInviteQuery(groupId);
  const [resetInvite, { isLoading: resetting }] = useResetInviteMutation();
  const [confirmReset, setConfirmReset] = useState(false);
  const [copied, setCopied] = useState<CopyKind | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const code = data?.code ?? null;
  const link = code ? inviteLink(window.location.origin, code) : null;
  const miniLink = data?.miniLink ?? null;
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  async function copy(kind: CopyKind, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      setMessage(null);
      setTimeout(() => setCopied((c) => (c === kind ? null : c)), 2000);
    } catch {
      setMessage("無法複製，請手動選取");
    }
  }

  async function share(url: string) {
    try {
      await navigator.share({ title: "加入揪帳群組", url });
    } catch {
      // The person dismissed the share sheet; nothing to report.
    }
  }

  // Issuing the first code and replacing a live one are the same request; only the latter asks first.
  async function issue() {
    try {
      await resetInvite({ groupId }).unwrap();
      setMessage(null);
    } catch (e) {
      setMessage(apiErrorText(e, code ? "重設失敗" : "產生失敗"));
    } finally {
      setConfirmReset(false);
    }
  }

  if (!data) {
    if (error && !isFetching) {
      return (
        <div className="py-2 text-center">
          <p className="text-sm text-destructive">無法載入邀請碼</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{describeError(error)}</p>
          <Button variant="outline" className="mt-3 w-full rounded-lg" onClick={() => refetch()}>
            重試
          </Button>
        </div>
      );
    }
    return (
      <div aria-busy="true" aria-label="載入中">
        <Skeleton className="h-[62px] rounded-lg" />
        <Skeleton className="mt-4 h-3.5 w-1/3 rounded-lg" />
        <Skeleton className="mt-2 h-9 rounded-lg" />
      </div>
    );
  }

  if (!code) {
    return (
      <div className="py-2 text-center">
        <span className="mx-auto flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary">
          <KeyRound className="size-5" />
        </span>
        <p className="mt-2.5 text-sm font-semibold">這個群組還沒有邀請碼</p>
        <p className="mt-0.5 text-xs text-muted-foreground">產生後，拿到連結或邀請碼的人就能加入</p>
        <Button className="mt-4 w-full rounded-lg" onClick={issue} disabled={resetting}>
          {resetting ? <Loader2 className="size-4 animate-spin" /> : "產生邀請碼"}
        </Button>
        {message && <p className="mt-2 text-xs text-destructive">{message}</p>}
      </div>
    );
  }

  const copyButton = (kind: CopyKind, text: string, label: string, surface = ON_DIALOG) => (
    <button onClick={() => copy(kind, text)} aria-label={label} className={cn(ACTION, surface)}>
      {copied === kind ? <Check className="size-4" /> : <Copy className="size-4" />}
      {copied === kind ? "已複製" : "複製"}
    </button>
  );

  // One row per kind of link: copy and share side by side, or copy alone across the row.
  // The row's title names the link, so the buttons say only 複製 / 分享 and never wrap;
  // their accessible names stay the full 複製網頁連結 / 分享 Telegram 連結.
  const linkRow = (kind: "link" | "mini", url: string, title: string, note: string) => {
    const named = (verb: string) => (/^[A-Za-z]/.test(title) ? `${verb} ${title}` : verb + title);
    return (
      <div role="group" aria-label={title}>
        <p className="mb-1.5 flex items-baseline gap-2 px-0.5">
          <span className="text-[13px] font-semibold">{title}</span>
          <span className="truncate text-[11px] text-muted-foreground">{note}</span>
        </p>
        <div className={cn("grid gap-2", canShare ? "grid-cols-2" : "grid-cols-1")}>
          {copyButton(kind, url, named("複製"))}
          {canShare && (
            <button
              onClick={() => share(url)}
              aria-label={named("分享")}
              className={cn(ACTION, ON_DIALOG)}
            >
              <Share2 className="size-4" />
              分享
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <>
      <div className="space-y-3.5">
        <div className="flex items-center gap-3 rounded-lg bg-secondary/50 px-3.5 py-3">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">邀請碼</p>
            <p className="num text-lg font-semibold tracking-wider">{formatInviteCode(code)}</p>
          </div>
          <div className="ml-auto shrink-0">
            {copyButton("code", formatInviteCode(code), "複製邀請碼", ON_PANEL)}
          </div>
        </div>
        {link && linkRow("link", link, "網頁連結", "用瀏覽器開啟，可用任何方式登入")}
        {miniLink && linkRow("mini", miniLink, "Telegram 連結", "在 Telegram 點開直接進 Mini App")}
      </div>

      <p
        className={cn(
          "mt-3.5 px-0.5 text-xs",
          message ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {message ?? hint}
      </p>

      <button
        onClick={() => setConfirmReset(true)}
        disabled={resetting}
        className="mt-3.5 flex w-full items-center gap-2 border-t border-border/60 pt-3 text-left text-[13px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
      >
        <RefreshCw className="size-3.5" />
        重設邀請碼
      </button>

      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title="重設邀請碼？"
        description="舊的連結和邀請碼會立即失效，已經加入的成員不受影響。"
        confirmLabel="重設"
        loading={resetting}
        onConfirm={issue}
      />
    </>
  );
}
