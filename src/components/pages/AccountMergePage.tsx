"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowDown, ArrowUp, ExternalLink, Loader2 } from "lucide-react";

import { Avatar } from "@/components/mini/Avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Platform } from "@/components/pages/platform";
import { useLoginRedirect } from "@/components/pages/use-login-redirect";
import { apiErrorStatus, apiErrorText, describeError } from "@/lib/api-error";
import type { AccountMergeSide } from "@/lib/api-types";
import { isLoginProvider, PROVIDER_LABEL } from "@/lib/identities";
import {
  useCancelAccountMergeMutation,
  useGetAccountMergePreviewQuery,
  useMergeAccountsMutation,
} from "@/store/api";

function providerList(providers: string[]): string {
  return providers.map((p) => (isLoginProvider(p) ? PROVIDER_LABEL[p] : p)).join("、") || "—";
}

/**
 * Merging two accounts (issue #99). On the web this is the confirm page the Auth.js `signIn`
 * callback sends people to after they completed another account's OAuth sign-in. The merge
 * starts with that sign-in, which can't run inside Telegram's webview, so the Mini App's copy
 * explains the steps and opens the Web App in the browser instead.
 */
export function AccountMergePage({ platform }: { platform: Platform }) {
  platform.useBack(`${platform.basePath}/settings`);
  return platform.openInBrowser ? (
    <MergeOnWeb openInBrowser={platform.openInBrowser} />
  ) : (
    <MergeConfirm platform={platform} />
  );
}

function MergeOnWeb({ openInBrowser }: { openInBrowser: (path: string) => void }) {
  return (
    <div className="space-y-6 py-4">
      <div className="px-4">
        <h1 className="text-lg font-semibold">合併帳號</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          如果你另外用 Google、LINE 或 GitHub
          登入過，建立了另一個帳號，可以把它併進這個帳號。合併要在網頁版操作，因為那些登入方式無法在
          Telegram 裡完成授權。
        </p>
      </div>
      <section className="px-4">
        <p className="sect mb-2.5">步驟</p>
        <ol className="list-decimal space-y-2 rounded-2xl bg-secondary/50 py-3 pl-9 pr-4 text-sm">
          <li>在瀏覽器開啟網頁版，用 Telegram 登入。</li>
          <li>到「個人設定 → 登入方式」，連結另一個帳號用的登入方式。</li>
          <li>系統會發現它屬於你的另一個帳號，請你確認是否合併。</li>
        </ol>
        <p className="mt-2 px-1 text-xs text-muted-foreground">
          合併後兩個帳號的群組和紀錄都在同一個帳號底下，無法還原。
        </p>
      </section>
      <div className="px-4">
        <Button className="w-full rounded-lg" onClick={() => openInBrowser("/app/settings")}>
          <ExternalLink className="size-4" />
          在瀏覽器開啟網頁版
        </Button>
      </div>
    </div>
  );
}

function MergeConfirm({ platform }: { platform: Platform }) {
  const SETTINGS = `${platform.basePath}/settings`;
  const router = useRouter();
  const { data, error } = useGetAccountMergePreviewQuery(undefined, {
    refetchOnMountOrArgChange: true,
  });
  const redirectingToLogin = useLoginRedirect(error, platform.loginPath);
  const [merge, { isLoading: merging }] = useMergeAccountsMutation();
  const [cancel, { isLoading: cancelling }] = useCancelAccountMergeMutation();
  const [picked, setPicked] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [selfChoice, setSelfChoice] = useState<"keep" | "delete">("keep");
  const [failure, setFailure] = useState<string | null>(null);

  // No live ticket: the cookie expired, was used, or never existed. Back to settings, which
  // says so; a merge that already went through cleared the cookie and lands there quietly.
  const expired = apiErrorStatus(error) === 404;
  useEffect(() => {
    if (expired) router.replace(`${SETTINGS}?merge=expired`);
  }, [expired, router, SETTINGS]);

  if (error && !redirectingToLogin && !expired) {
    return (
      <div className="px-4 py-12 text-center">
        <p className="text-sm text-muted-foreground">無法載入</p>
        <p className="mt-1 text-xs text-muted-foreground/60">{describeError(error)}</p>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  async function leave() {
    await cancel().catch(() => undefined);
    router.push(SETTINGS);
  }

  if (data.blocked) {
    return (
      <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-destructive/10">
          <AlertCircle className="size-6 text-destructive" />
        </div>
        <h1 className="text-lg font-semibold">這兩個帳號不能合併</h1>
        <p className="text-sm text-muted-foreground">{data.blocked}</p>
        <Button variant="outline" className="mt-2 rounded-lg" onClick={leave} disabled={cancelling}>
          回到個人設定
        </Button>
      </div>
    );
  }

  const keepId = picked ?? data.suggestedKeepId;
  const keep = data.accounts.find((a) => a.userId === keepId)!;
  const absorb = data.accounts.find((a) => a.userId !== keepId)!;
  const providers = [...new Set([...keep.providers, ...absorb.providers])];

  async function confirm() {
    setFailure(null);
    try {
      await merge({ keepUserId: keepId, selfSettlements: selfChoice }).unwrap();
      // A full load, not a cache refresh: this session may now belong to the other user.
      window.location.assign(`${SETTINGS}?merge=done`);
    } catch (e) {
      if (apiErrorStatus(e) === 404) {
        router.replace(`${SETTINGS}?merge=expired`);
        return;
      }
      setFailure(apiErrorText(e, "合併失敗，請再試一次"));
    }
  }

  const accountCard = (a: AccountMergeSide) => (
    <label
      key={a.userId}
      className="flex min-h-11 cursor-pointer items-center gap-3 rounded-2xl border-[1.5px] bg-card px-3.5 py-3 has-[:checked]:border-primary"
    >
      <input
        type="radio"
        name="keep-account"
        checked={keepId === a.userId}
        onChange={() => setPicked(a.userId)}
      />
      <Avatar src={a.photoUrl} name={a.name} userId={a.userId} size="md" />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5 font-semibold">
          {a.name}
          {a.userId === data.suggestedKeepId && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-normal text-primary">
              建議
            </span>
          )}
          {a.isCurrent && (
            <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-normal text-muted-foreground">
              目前登入
            </span>
          )}
        </span>
        <span className="block text-xs text-muted-foreground">
          {providerList(a.providers)} · {a.groupCount} 個群組 ·{" "}
          <span className="num">{a.recordCount}</span> 筆紀錄
        </span>
      </span>
    </label>
  );

  return (
    <div className="space-y-6 py-4">
      <div className="px-4">
        <button onClick={leave} disabled={cancelling} className="mb-2 text-sm text-primary">
          ‹ 取消
        </button>
        <h1 className="text-lg font-semibold">合併帳號</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          你剛才登入的帳號屬於另一個帳號。兩邊你都已經登入過，可以把它們合併成一個。
        </p>
      </div>

      <section className="px-4">
        <p className="sect mb-2.5">保留哪個帳號</p>
        <fieldset className="flex flex-col gap-2">
          <legend className="sr-only">保留哪個帳號</legend>
          {/* Fixed order, so picking the other account doesn't make the rows jump. */}
          {accountCard(data.accounts[0])}
          <p className="flex items-center justify-center gap-1 text-xs text-muted-foreground">
            {keepId === data.accounts[0].userId ? (
              <ArrowUp className="size-3.5" />
            ) : (
              <ArrowDown className="size-3.5" />
            )}
            併入
          </p>
          {accountCard(data.accounts[1])}
        </fieldset>
        <p className="mt-2 px-1 text-xs text-muted-foreground">
          保留的帳號沿用它的名稱與頭像；它缺的資料（例如 Telegram、Email）會從另一邊補上。
        </p>
      </section>

      <section className="px-4">
        <p className="sect mb-2.5">合併後</p>
        <div className="divide-y divide-border/40 overflow-hidden rounded-2xl bg-secondary/50 text-sm">
          <div className="flex justify-between gap-3 px-4 py-3">
            <span>群組</span>
            <span className="num font-medium">
              {data.totalGroups} 個
              {data.sharedGroups.length > 0 && `（${data.sharedGroups.length} 個兩邊都在）`}
            </span>
          </div>
          <div className="flex justify-between gap-3 px-4 py-3">
            <span>改記到 {keep.name} 名下的紀錄</span>
            <span className="num font-medium">{absorb.recordCount} 筆</span>
          </div>
          <div className="flex justify-between gap-3 px-4 py-3">
            <span>登入方式</span>
            <span className="font-medium">{providerList(providers)}</span>
          </div>
        </div>
        {data.sharedGroups.length > 0 && (
          <p className="mt-2 px-1 text-xs text-muted-foreground">
            {data.sharedGroups.map((g) => `「${g.title}」`).join("")}
            兩個帳號都是成員，會併成一位成員；同一筆帳目上的付款與分攤會加總，餘額不變。
          </p>
        )}
      </section>

      <div className="px-4">
        <Button className="w-full rounded-lg" onClick={() => setConfirming(true)}>
          合併帳號…
        </Button>
      </div>

      <Dialog open={confirming} onOpenChange={(open) => !merging && setConfirming(open)}>
        <DialogContent className="max-w-sm rounded-2xl">
          <DialogHeader>
            <DialogTitle>
              把「{absorb.name}」併入「{keep.name}」？
            </DialogTitle>
            <DialogDescription asChild>
              <ul className="list-disc space-y-1 pl-5 text-left">
                <li>
                  {absorb.name} 的 {absorb.groupCount} 個群組、{absorb.recordCount} 筆紀錄改到{" "}
                  {keep.name} 名下
                </li>
                <li>
                  之後用{providerList(providers)}登入都是 {keep.name}
                </li>
                <li>各群組的動態會記下這次合併</li>
              </ul>
            </DialogDescription>
          </DialogHeader>

          {data.selfSettlements > 0 && (
            <fieldset className="flex flex-col gap-2 text-sm">
              <legend className="mb-1 font-medium">
                你們之間有 {data.selfSettlements} 筆還款，合併後會變成自己還自己
              </legend>
              <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border px-3 py-2 has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                <input
                  type="radio"
                  name="self-settlements"
                  className="mt-1"
                  checked={selfChoice === "keep"}
                  onChange={() => setSelfChoice("keep")}
                  disabled={merging}
                />
                <span>
                  保留這些還款
                  <span className="block text-xs text-muted-foreground">
                    之後不能再編輯，只能刪除。
                  </span>
                </span>
              </label>
              <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border px-3 py-2 has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                <input
                  type="radio"
                  name="self-settlements"
                  className="mt-1"
                  checked={selfChoice === "delete"}
                  onChange={() => setSelfChoice("delete")}
                  disabled={merging}
                />
                <span>
                  一併刪除這些還款
                  <span className="block text-xs text-muted-foreground">
                    不影響餘額，動態紀錄和群組訊息會留下刪除記錄。
                  </span>
                </span>
              </label>
            </fieldset>
          )}

          <p className="rounded-lg bg-destructive/10 px-3.5 py-2.5 text-sm text-destructive">
            合併後無法還原，{absorb.name} 這個帳號會消失。
          </p>
          {failure && <p className="text-sm text-destructive">{failure}</p>}

          <DialogFooter className="flex-row gap-2">
            <Button
              variant="outline"
              className="flex-1 rounded-lg"
              onClick={() => setConfirming(false)}
              disabled={merging}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              className="flex-1 rounded-lg"
              onClick={confirm}
              disabled={merging}
            >
              {merging && <Loader2 className="size-4 animate-spin" />}
              合併
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
