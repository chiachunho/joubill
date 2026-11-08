"use client";

import { use } from "react";

import { SettingsSubpageSkeleton } from "@/components/mini/skeletons";
import { TelegramChatSettings } from "@/components/mini/TelegramChatSettings";
import type { Platform } from "@/components/pages/platform";
import { describeError } from "@/lib/api-error";
import { useGetGroupChatQuery } from "@/store/api";

/**
 * Telegram 群組: the one page behind the group settings row of the same name. Binding, unlinking
 * and 記帳通知發送位置 all live here, so the settings card keeps a single entry for the chat.
 */
export function GroupTelegramPage({
  params,
  platform,
}: {
  params: Promise<{ id: string }>;
  platform: Platform;
}) {
  const { id } = use(params);

  const backHref = `${platform.basePath}/groups/${id}/settings`;
  platform.useBack(backHref);

  const { data: chat, error, refetch } = useGetGroupChatQuery(id);

  if (error && !chat) {
    return (
      <div className="px-4 py-12 text-center">
        <p className="text-sm text-muted-foreground">無法載入</p>
        <p className="mt-1 text-xs text-muted-foreground/60">{describeError(error)}</p>
      </div>
    );
  }

  if (!chat) return <SettingsSubpageSkeleton />;

  return (
    <div className="space-y-6 py-4">
      <div className="px-4">
        <platform.BackLink href={backHref} />
        <h1 className="text-lg font-semibold">Telegram 群組</h1>
      </div>
      <TelegramChatSettings groupId={id} chat={chat} onUnlinkConflict={() => refetch()} />
    </div>
  );
}
