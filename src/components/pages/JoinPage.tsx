"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Avatar } from "@/components/mini/Avatar";
import { JoinSkeleton } from "@/components/mini/skeletons";
import type { Platform } from "@/components/pages/platform";
import { useLoginRedirect } from "@/components/pages/use-login-redirect";
import { Button } from "@/components/ui/button";
import { apiErrorStatus, apiErrorText } from "@/lib/api-error";
import { decodeInviteParam, INVITE_NOT_FOUND, normalizeInviteCode } from "@/lib/invite";
import { useAcceptInviteMutation, useGetInvitePreviewQuery } from "@/store/api";

const INVALID = INVITE_NOT_FOUND.error;

/**
 * /join/<code>: what a shared link opens. Not signed in → the store's 401 handling sends the
 * viewer to /login?next=/join/<code> and back. The preview is shown before anything is joined.
 */
export function JoinPage({
  params,
  platform,
}: {
  params: Promise<{ code: string }>;
  platform: Platform;
}) {
  const router = useRouter();
  const raw = decodeInviteParam(use(params).code);
  const code = raw === null ? null : normalizeInviteCode(raw);

  const { data, error, refetch } = useGetInvitePreviewQuery(code ?? "", { skip: !code });
  // The placeholder the visitor says they are; null is "都不是".
  const [claimId, setClaimId] = useState<number | null>(null);
  const [accept, { isLoading: joining, error: joinError }] = useAcceptInviteMutation();
  const redirecting = useLoginRedirect(error ?? joinError, platform.loginPath);

  async function join() {
    if (!code) return;
    try {
      // Only claim a name the preview still lists; a stale pick would refuse the whole join.
      const claim = data?.placeholders.some((p) => p.id === claimId) ? claimId : null;
      const { groupId } = await accept({
        code,
        ...(claim !== null ? { placeholderUserId: claim } : {}),
      }).unwrap();
      router.replace(`${platform.basePath}/groups/${groupId}`);
    } catch {
      // The error is shown below. Re-read the list: the name picked may have been claimed
      // or removed since this page loaded, and the preview is not otherwise invalidated.
      refetch();
    }
  }

  if (redirecting) return null;

  // Unknown, revoked, expired and malformed codes read the same on purpose. Only a 404 means
  // that: a server error or a dropped connection says nothing about the code, so it can retry.
  const notFound = !code || (error && apiErrorStatus(error) === INVITE_NOT_FOUND.status);
  if (notFound) {
    return (
      <div className="px-4 py-16 text-center">
        <p className="font-semibold">{INVALID}</p>
        <p className="mt-1 text-sm text-muted-foreground">請向邀請你的人再要一組新的邀請碼</p>
        <Link href={platform.basePath} className="mt-6 inline-block text-sm text-primary">
          回首頁
        </Link>
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-4 py-16 text-center">
        <p className="font-semibold">載入失敗</p>
        <p className="mt-1 text-sm text-muted-foreground">請檢查網路後再試一次</p>
        <Button className="mt-6" variant="secondary" onClick={() => refetch()}>
          重試
        </Button>
      </div>
    );
  }

  if (!data) return <JoinSkeleton />;

  const claimed = data.placeholders.find((p) => p.id === claimId);

  return (
    <div className="flex flex-col items-center gap-2 px-4 py-16 text-center">
      <Avatar name={data.title} userId={data.groupId} size="lg" />
      <h1 className="mt-1 text-lg font-semibold">{data.title}</h1>
      <p className="text-sm text-muted-foreground">{data.memberCount} 位成員</p>

      {data.alreadyMember ? (
        <>
          <p className="mt-4 text-sm text-muted-foreground">你已經在這個群組裡了</p>
          <Button asChild className="mt-2 w-full max-w-xs">
            <Link href={`${platform.basePath}/groups/${data.groupId}`}>前往群組</Link>
          </Button>
        </>
      ) : (
        <>
          {data.placeholders.length > 0 && (
            <fieldset className="mt-6 w-full max-w-xs rounded-2xl border bg-card p-4 text-left">
              <legend className="sr-only">你是下面其中一位嗎？</legend>
              <p className="text-sm font-semibold">你是下面其中一位嗎？</p>
              <p className="mt-1 text-xs text-muted-foreground">
                選了會把他的紀錄併到你的帳號，之後無法還原。
              </p>
              <div className="mt-3 flex flex-col gap-2">
                {data.placeholders.map((p) => (
                  <label
                    key={p.id}
                    className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border px-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5"
                  >
                    <input
                      type="radio"
                      name="claim"
                      checked={claimId === p.id}
                      onChange={() => setClaimId(p.id)}
                      disabled={joining}
                    />
                    {p.name}
                  </label>
                ))}
                <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border px-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                  <input
                    type="radio"
                    name="claim"
                    checked={claimId === null}
                    onChange={() => setClaimId(null)}
                    disabled={joining}
                  />
                  都不是，我是新成員
                </label>
              </div>
            </fieldset>
          )}
          <Button className="mt-6 w-full max-w-xs" onClick={join} disabled={joining}>
            {joining ? "加入中…" : claimed ? `加入並認領「${claimed.name}」` : "加入"}
          </Button>
          {joinError && (
            <p className="mt-2 text-sm text-destructive">{apiErrorText(joinError, INVALID)}</p>
          )}
        </>
      )}
    </div>
  );
}
