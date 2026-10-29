"use client";

import { use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Avatar } from "@/components/mini/Avatar";
import type { Platform } from "@/components/pages/platform";
import { useLoginRedirect } from "@/components/pages/use-login-redirect";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
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
  const [accept, { isLoading: joining, error: joinError }] = useAcceptInviteMutation();
  const redirecting = useLoginRedirect(error ?? joinError, platform.loginPath);

  async function join() {
    if (!code) return;
    try {
      const { groupId } = await accept({ code }).unwrap();
      router.replace(`${platform.basePath}/groups/${groupId}`);
    } catch {
      // Shown below from the mutation's error.
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

  if (!data) {
    return (
      <div className="flex flex-col items-center gap-3 px-4 py-16">
        <Skeleton className="size-14 rounded-full" />
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-3.5 w-24" />
      </div>
    );
  }

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
          <Button className="mt-6 w-full max-w-xs" onClick={join} disabled={joining}>
            {joining ? "加入中…" : "加入"}
          </Button>
          {joinError && (
            <p className="mt-2 text-sm text-destructive">{apiErrorText(joinError, INVALID)}</p>
          )}
        </>
      )}
    </div>
  );
}
