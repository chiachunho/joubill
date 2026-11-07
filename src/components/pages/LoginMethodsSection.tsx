"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronRight, KeyRound, Link2, Merge, Unlink, X } from "lucide-react";

import { IconTile } from "@/components/mini/IconTile";
import { ConfirmDialog } from "@/components/mini/ConfirmDialog";
import type { Platform } from "@/components/pages/platform";
import { MERGE_TICKET_NOT_FOUND } from "@/lib/account-merge";
import { apiErrorText } from "@/lib/api-error";
import { isInAppBrowser } from "@/lib/in-app-browser";
import {
  canUnlink,
  isLoginProvider,
  LINK_ERROR_PARAM,
  linkableNow,
  linkErrorMessage,
  PROVIDER_LABEL,
  type LoginProvider,
} from "@/lib/identities";
import { forgetLinking, peekLinking } from "@/lib/linking-attempt";
import { useGetIdentitiesQuery, useUnlinkIdentityMutation } from "@/store/api";

type Alert = { text: string; retry: LoginProvider | null };

/**
 * What the page was sent back with: the outcome of a link that didn't finish (/login,
 * issue #105) or of the merge page (/app/settings/merge). Only reads, so it is safe to run
 * while rendering. The server has no URL to read, but this section renders nothing until its
 * data has loaded, so what the server and the first client render show cannot differ.
 */
function readArrival(): { alert: Alert | null; notice: string | null } {
  if (typeof window === "undefined") return { alert: null, notice: null };
  const params = new URLSearchParams(window.location.search);
  const merge = params.get("merge");
  const linkError = params.get(LINK_ERROR_PARAM);
  if (linkError !== null) {
    const provider = peekLinking();
    return {
      alert: { text: linkErrorMessage(linkError, provider), retry: provider },
      notice: null,
    };
  }
  if (merge === "done") {
    return {
      alert: null,
      notice: "已合併，兩個帳號原本的登入方式現在都會登入這個帳號。",
    };
  }
  if (merge === "expired")
    return { alert: { text: MERGE_TICKET_NOT_FOUND, retry: null }, notice: null };
  return { alert: null, notice: null };
}

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
  const [arrival] = useState(readArrival);
  const notice = arrival.notice;
  // A link or merge that came back unfinished. Shown above the list, where the person will
  // look for the provider they just tried; `retry` is that provider when it is known.
  const [alert, setAlert] = useState<Alert | null>(arrival.alert);
  const alertRef = useRef<HTMLDivElement>(null);

  // What `readArrival` showed is now on screen, so drop it from the URL; a reload doesn't
  // announce the same thing again.
  useEffect(() => {
    // Forgotten on every visit, so an attempt that ended in a link or a merge offer can't be
    // blamed for a later error that started somewhere else (such as the login page).
    forgetLinking();
    if (!arrival.alert && !arrival.notice) return;
    const params = new URLSearchParams(window.location.search);
    params.delete("merge");
    params.delete(LINK_ERROR_PARAM);
    const query = params.toString();
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}`,
    );
  }, [arrival]);

  // The section sits below the profile card, so bring the message into view once it renders.
  // Keyed on "loaded", not `data`, so a refetch (after an unlink) doesn't scroll the page again.
  const loaded = data !== undefined;
  useEffect(() => {
    if (alert && loaded) alertRef.current?.scrollIntoView?.({ block: "center" });
  }, [alert, loaded]);

  if (!data) return null;

  const linked = data.linked.filter(isLoginProvider);
  const addable = platform.linkIdentity ? linkableNow(data.enabled, data.linked) : [];
  // Read here, after the data has loaded, so it only ever runs in the browser. Google refuses
  // OAuth inside LINE's / Telegram's built-in browser, same as on the login page.
  const googleBlocked = isInAppBrowser(navigator.userAgent);
  const blocked = (provider: LoginProvider) => provider === "google" && googleBlocked;

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
      {alert && (
        <div
          ref={alertRef}
          role="alert"
          className="mb-2.5 flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          <div className="flex-1 space-y-2">
            <p>{alert.text}</p>
            {alert.retry && addable.includes(alert.retry) && !blocked(alert.retry) && (
              <button
                onClick={() => {
                  const provider = alert.retry!;
                  setAlert(null);
                  platform.linkIdentity?.(provider);
                }}
                className="rounded-lg bg-destructive px-2.5 py-1 text-xs font-semibold text-destructive-foreground"
              >
                再試一次
              </button>
            )}
          </div>
          <button
            onClick={() => setAlert(null)}
            aria-label="關閉"
            className="-mr-1 rounded-lg p-1 transition-colors hover:bg-destructive/10"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}
      <div className="divide-y divide-border/40 overflow-hidden rounded-2xl bg-secondary/50">
        {linked.map((provider) => {
          const verdict = canUnlink(provider, data.linked);
          return (
            <div key={provider} className="flex items-center gap-3 px-4 py-3">
              <IconTile icon={KeyRound} />
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
            <IconTile icon={Merge} />
            <span className="flex-1 text-sm">合併另一個帳號</span>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground/40" />
          </Link>
        )}
        {addable.map((provider) => (
          <button
            key={provider}
            onClick={() => platform.linkIdentity?.(provider)}
            disabled={blocked(provider)}
            className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/30 active:bg-accent/50 disabled:opacity-50 disabled:hover:bg-transparent"
          >
            <IconTile icon={Link2} />
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
