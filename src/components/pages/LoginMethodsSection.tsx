"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRight, KeyRound, Link2, Merge, Unlink } from "lucide-react";

import { ConfirmDialog } from "@/components/mini/ConfirmDialog";
import type { Platform } from "@/components/pages/platform";
import { MERGE_TICKET_NOT_FOUND } from "@/lib/account-merge";
import { apiErrorText } from "@/lib/api-error";
import { isInAppBrowser } from "@/lib/in-app-browser";
import {
  canUnlink,
  isLoginProvider,
  linkableNow,
  PROVIDER_LABEL,
  type LoginProvider,
} from "@/lib/identities";
import { useGetIdentitiesQuery, useUnlinkIdentityMutation } from "@/store/api";

/**
 * 個人設定的「登入方式」: the login methods on this account, with link / unlink. Linking is
 * what lets someone who started in Telegram sign in with Google later and still see their
 * groups; a Google login that wasn't linked first would be a brand-new, empty account.
 */
export function LoginMethodsSection({ platform }: { platform: Platform }) {
  const { data } = useGetIdentitiesQuery();
  const [unlink, { isLoading: unlinking }] = useUnlinkIdentityMutation();
  const [confirming, setConfirming] = useState<LoginProvider | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // The merge page (/app/settings/merge) sends people back here with the outcome.
  useEffect(() => {
    const merge = new URLSearchParams(window.location.search).get("merge");
    if (merge === "done") setNotice("已合併，兩個帳號原本的登入方式現在都會登入這個帳號。");
    else if (merge === "expired") setMessage(MERGE_TICKET_NOT_FOUND);
  }, []);

  if (!data) return null;

  const linked = data.linked.filter(isLoginProvider);
  const addable = platform.linkIdentity ? linkableNow(data.enabled, data.linked) : [];
  // Read here, after the data has loaded, so it only ever runs in the browser. Google refuses
  // OAuth inside LINE's / Telegram's built-in browser, same as on the login page.
  const googleBlocked = isInAppBrowser(navigator.userAgent);

  async function confirmUnlink() {
    if (!confirming) return;
    try {
      await unlink({ provider: confirming }).unwrap();
      setMessage(null);
    } catch (e) {
      setMessage(apiErrorText(e, "解除連結失敗"));
    }
    setConfirming(null);
  }

  return (
    <section className="px-4">
      <p className="sect mb-2.5">登入方式</p>
      <div className="divide-y divide-border/40 overflow-hidden rounded-2xl bg-secondary/50">
        {linked.map((provider) => {
          const verdict = canUnlink(provider, data.linked);
          return (
            <div key={provider} className="flex items-center gap-3 px-4 py-3">
              <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
                <KeyRound className="size-3.5 text-primary" />
              </div>
              <span className="flex-1 text-sm">{PROVIDER_LABEL[provider]}</span>
              {platform.linkIdentity && verdict.ok && (
                <button
                  onClick={() => setConfirming(provider)}
                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-destructive transition-colors hover:bg-destructive/10"
                >
                  <Unlink className="size-3.5" />
                  解除連結
                </button>
              )}
            </div>
          );
        })}
        {platform.openInBrowser && (
          // The Mini App can't run OAuth, so merging starts on the web; this page says how.
          <Link
            href={`${platform.basePath}/settings/merge`}
            className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/30 active:bg-accent/50"
          >
            <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
              <Merge className="size-3.5 text-primary" />
            </div>
            <span className="flex-1 text-sm">合併另一個帳號</span>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground/40" />
          </Link>
        )}
        {addable.map((provider) => (
          <button
            key={provider}
            onClick={() => platform.linkIdentity?.(provider)}
            disabled={provider === "google" && googleBlocked}
            className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/30 active:bg-accent/50 disabled:opacity-50 disabled:hover:bg-transparent"
          >
            <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
              <Link2 className="size-3.5 text-primary" />
            </div>
            <span className="flex-1 text-sm">連結 {PROVIDER_LABEL[provider]}</span>
          </button>
        ))}
      </div>
      <p className="mt-2 px-1 text-xs text-muted-foreground">
        {platform.linkIdentity
          ? "先把其他登入方式連結到這個帳號，之後用它登入才會看到原本的群組。如果那個登入方式已經屬於你的另一個帳號，會讓你選擇把兩個帳號合併。"
          : "要連結其他登入方式，請用瀏覽器開啟網頁版，在個人設定裡操作。"}
      </p>
      {googleBlocked && addable.includes("google") && (
        <p className="mt-2 px-1 text-xs text-muted-foreground">
          Google 不允許在 App 內建瀏覽器登入，請用瀏覽器開啟這個頁面再連結。
        </p>
      )}
      {notice && <p className="mt-2 px-1 text-xs text-primary">{notice}</p>}
      {message && <p className="mt-2 px-1 text-xs text-destructive">{message}</p>}

      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => !open && setConfirming(null)}
        title={`解除 ${confirming ? PROVIDER_LABEL[confirming] : ""} 連結？`}
        description="解除後就不能再用它登入這個帳號。你的群組與紀錄不受影響。"
        confirmLabel="解除連結"
        variant="destructive"
        loading={unlinking}
        onConfirm={confirmUnlink}
      />
    </section>
  );
}
