"use client";

import { useState } from "react";
import { Check, Copy, KeyRound, RefreshCw, Share2 } from "lucide-react";

import { ConfirmDialog } from "@/components/mini/ConfirmDialog";
import { apiErrorText } from "@/lib/api-error";
import { formatInviteCode, inviteLink } from "@/lib/invite";
import { useGetInviteQuery, useResetInviteMutation } from "@/store/api";

/** 群組設定的「邀請成員」: the live invite code and link, with copy / share / reset. */
export function InviteSection({ groupId }: { groupId: string }) {
  const { data, error } = useGetInviteQuery(groupId);
  const [resetInvite, { isLoading: resetting }] = useResetInviteMutation();
  const [confirmReset, setConfirmReset] = useState(false);
  const [copied, setCopied] = useState<"link" | "mini" | "code" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const code = data?.code;
  const link = code ? inviteLink(window.location.origin, code) : null;
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  const miniLink = data?.miniLink ?? null;

  async function copy(kind: "link" | "mini" | "code") {
    const text =
      kind === "link" ? link : kind === "mini" ? miniLink : code && formatInviteCode(code);
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setMessage("無法複製，請手動選取");
    }
  }

  async function share(url: string | null) {
    if (!url) return;
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
      setConfirmReset(false);
      setMessage(null);
    } catch (e) {
      setConfirmReset(false);
      setMessage(apiErrorText(e, code ? "重設失敗" : "產生失敗"));
    }
  }

  return (
    <section className="px-4">
      <p className="sect mb-2.5">邀請成員</p>
      <div className="overflow-hidden rounded-2xl bg-secondary/50">
        <div className="flex items-center gap-3 px-4 py-3">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <KeyRound className="size-3.5" />
          </span>
          <span className="text-sm">邀請碼</span>
          <span className="num ml-auto text-sm font-semibold tracking-wider">
            {code ? formatInviteCode(code) : error ? "無法載入" : data ? "尚未產生" : "載入中…"}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2 border-t border-border/40 p-3">
          <button
            onClick={() => copy("link")}
            disabled={!link}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-background/60 px-3 py-2 text-sm transition-colors hover:bg-accent/40 disabled:opacity-50"
          >
            {copied === "link" ? <Check className="size-4" /> : <Copy className="size-4" />}
            {copied === "link" ? "已複製" : "複製網頁連結"}
          </button>
          {miniLink && (
            <button
              onClick={() => copy("mini")}
              className="col-span-2 inline-flex items-center justify-center gap-1.5 rounded-lg bg-background/60 px-3 py-2 text-sm transition-colors hover:bg-accent/40"
            >
              {copied === "mini" ? <Check className="size-4" /> : <Copy className="size-4" />}
              {copied === "mini" ? "已複製" : "複製 Telegram 連結"}
            </button>
          )}
          <button
            onClick={() => copy("code")}
            disabled={!code}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-background/60 px-3 py-2 text-sm transition-colors hover:bg-accent/40 disabled:opacity-50"
          >
            {copied === "code" ? <Check className="size-4" /> : <Copy className="size-4" />}
            {copied === "code" ? "已複製" : "複製邀請碼"}
          </button>
          {canShare && (
            <button
              onClick={() => share(link)}
              disabled={!link}
              className={`${miniLink ? "" : "col-span-2"}inline-flex items-center justify-center gap-1.5 rounded-lg bg-background/60 px-3 py-2 text-sm transition-colors hover:bg-accent/40 disabled:opacity-50`}
            >
              <Share2 className="size-4" />
              分享網頁連結
            </button>
          )}
          {canShare && miniLink && (
            <button
              onClick={() => share(miniLink)}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-background/60 px-3 py-2 text-sm transition-colors hover:bg-accent/40"
            >
              <Share2 className="size-4" />
              分享 Telegram 連結
            </button>
          )}
        </div>
        {/* Only once the read has answered: before that the label would claim there is no code. */}
        {data && (
          <button
            onClick={() => (code ? setConfirmReset(true) : issue())}
            disabled={resetting}
            className="flex w-full items-center gap-3 border-t border-border/40 px-4 py-3 text-left text-sm transition-colors hover:bg-accent/30 active:bg-accent/50 disabled:opacity-50"
          >
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <RefreshCw className="size-3.5" />
            </span>
            {code ? "重設邀請碼" : "產生邀請碼"}
          </button>
        )}
      </div>
      <p className="mt-2 px-1 text-xs text-muted-foreground">
        {message ?? "任何拿到連結或邀請碼的人都能加入。重設後，舊的連結和邀請碼會立即失效。"}
      </p>

      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title="重設邀請碼？"
        description="舊的連結和邀請碼會立即失效，已經加入的成員不受影響。"
        confirmLabel="重設"
        loading={resetting}
        onConfirm={issue}
      />
    </section>
  );
}
