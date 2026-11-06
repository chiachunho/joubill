"use client";

import { useState } from "react";
import { ExternalLink, Loader2, ShieldCheck } from "lucide-react";

import {
  AppAccessPicker,
  AppScopePicker,
  scopeIsValid,
  type Scope,
} from "@/components/mini/AppFormFields";
import { Button } from "@/components/ui/button";
import type { Platform } from "@/components/pages/platform";
import { useLoginRedirect } from "@/components/pages/use-login-redirect";
import { Skeleton } from "@/components/ui/skeleton";
import { useDecideOauthConsentMutation, useGetOauthConsentQuery } from "@/store/api";
import { OAUTH_CONSENT_PATH } from "@/lib/help-url";

type Failure = { message: string; redirectTo: string | null };

/**
 * Where a Claude.ai / ChatGPT connection asks the person to approve it (issue #152). OAuth
 * needs a real browser (Telegram's webview can't be the redirect target of another app),
 * so the Mini App's copy of this page only says so and offers to continue in the browser;
 * the Web App's runs the decision.
 */
export function OAuthConsentPage({ platform }: { platform: Platform }) {
  platform.useBack(platform.basePath);
  return platform.openInBrowser ? (
    <NotSupportedInMini openInBrowser={platform.openInBrowser} />
  ) : (
    <Consent platform={platform} />
  );
}

function NotSupportedInMini({ openInBrowser }: { openInBrowser: (path: string) => void }) {
  return (
    <div className="space-y-6 py-4">
      <div className="px-4">
        <h1 className="text-lg font-semibold">連結應用程式</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Mini App 不支援這個授權：Telegram 內建的瀏覽器無法完成
          OAuth。請改用手機或電腦的瀏覽器開啟網頁版，在那裡按「允許」。
        </p>
      </div>
      <div className="px-4">
        <Button
          className="w-full rounded-lg"
          onClick={() => openInBrowser(`${OAUTH_CONSENT_PATH}${window.location.search}`)}
        >
          <ExternalLink className="size-4" />
          用瀏覽器開啟
        </Button>
      </div>
    </div>
  );
}

/** The OAuth-style body of a failed consent request, if the server sent one. */
function consentFailure(error: unknown, fallback: string): Failure {
  const data = (error as { data?: Record<string, unknown> } | null)?.data ?? {};
  const text = data.error_description ?? data.error;
  return {
    message: typeof text === "string" && text !== "" ? text : fallback,
    redirectTo: typeof data.redirectTo === "string" ? data.redirectTo : null,
  };
}

function Consent({ platform }: { platform: Platform }) {
  const search = typeof window === "undefined" ? "" : window.location.search;
  const { data: info, error } = useGetOauthConsentQuery(search);
  const [decide, { isLoading: submitting, error: decideError }] = useDecideOauthConsentMutation();
  const redirectingToLogin = useLoginRedirect(error, platform.loginPath);
  // The narrowest grant: asking for write only makes it available, the person turns it on.
  const [access, setAccess] = useState<"read" | "write">("read");
  const [scope, setScope] = useState<Scope>({ allGroups: false, groupIds: [] });
  const [left, setLeft] = useState(false);

  async function answer(approve: boolean) {
    const params = Object.fromEntries(new URLSearchParams(search));
    const res = await decide({ params, approve, access, ...scope });
    if (res.data) {
      setLeft(true);
      window.location.href = res.data.redirectTo;
    }
  }

  const failed = decideError ?? (redirectingToLogin ? null : error);
  const failure = failed
    ? consentFailure(failed, decideError ? "授權失敗，請再試一次" : "這個連線要求無效")
    : null;
  if (failure && !left) {
    return (
      <div className="space-y-4 px-4 py-6">
        <h1 className="text-lg font-semibold">無法連線</h1>
        <p className="text-sm text-muted-foreground">{failure.message}</p>
        {failure.redirectTo && (
          <Button
            variant="outline"
            className="w-full rounded-lg"
            onClick={() => (window.location.href = failure.redirectTo as string)}
          >
            回到應用程式
          </Button>
        )}
      </div>
    );
  }
  if (!info || redirectingToLogin) return <ConsentSkeleton />;

  const canWrite = info.requestedAccess === "write";
  return (
    <div className="space-y-6 py-4">
      <div className="px-4 text-center">
        <ShieldCheck className="mx-auto size-8 text-primary" aria-hidden />
        <h1 className="mt-2 text-lg font-semibold">「{info.client.name}」想要連線到你的揪帳</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          允許後，授權會交給 <span className="font-medium">{info.client.redirectLabel}</span>
          。如果你不認得這個網址，請按取消。
        </p>
      </div>

      <section className="px-4">
        <p className="sect mb-2.5">它可以</p>
        <ul className="space-y-1.5 rounded-2xl bg-secondary/50 px-4 py-3 text-sm">
          <li>查看你選的群組的成員、餘額和紀錄</li>
          {access === "write" && (
            <li>
              新增、編輯、刪除紀錄與還款
              <span className="block text-xs text-muted-foreground">
                群組會看到「透過 {info.client.name} 記錄」
              </span>
            </li>
          )}
          <li className="text-muted-foreground">
            不能建立或刪除群組、邀請成員、合併帳號、修改匯率設定
          </li>
        </ul>
      </section>

      <section className="space-y-4 px-4">
        {canWrite ? (
          <AppAccessPicker value={access} onChange={setAccess} />
        ) : (
          <p className="text-xs text-muted-foreground">這個應用程式只要求查看，不會寫入。</p>
        )}
        {info.groups.length > 0 ? (
          <AppScopePicker groups={info.groups} value={scope} onChange={setScope} />
        ) : (
          <p className="text-sm text-muted-foreground">你還沒有加入任何群組。</p>
        )}
      </section>

      <div className="grid grid-cols-2 gap-2 px-4">
        <Button
          variant="outline"
          className="rounded-lg"
          disabled={submitting || left}
          onClick={() => answer(false)}
        >
          取消
        </Button>
        <Button
          className="rounded-lg"
          disabled={submitting || left || !scopeIsValid(scope)}
          onClick={() => answer(true)}
        >
          {submitting && <Loader2 className="size-4 animate-spin" />}
          允許
        </Button>
      </div>
      <p className="px-4 text-center text-xs text-muted-foreground">
        之後可以在 個人設定 → 連結的應用程式 隨時撤銷。
      </p>
    </div>
  );
}

function ConsentSkeleton() {
  return (
    <div className="space-y-6 py-4" aria-busy="true" aria-label="載入中">
      <div className="space-y-2 px-4">
        <Skeleton className="mx-auto h-5 w-2/3" />
        <Skeleton className="mx-auto h-3 w-3/4" />
      </div>
      <div className="px-4">
        <Skeleton className="h-28 rounded-2xl" />
      </div>
      <div className="px-4">
        <Skeleton className="h-32 rounded-lg" />
      </div>
    </div>
  );
}
