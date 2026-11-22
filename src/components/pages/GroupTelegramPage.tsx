"use client";

import { use } from "react";

import { PageHeader } from "@/components/mini/PageHeader";
import { SettingsSubpageSkeleton } from "@/components/mini/skeletons";
import { TelegramChatSettings } from "@/components/mini/TelegramChatSettings";
import { LoadError } from "@/components/mini/LoadError";
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
    return <LoadError detail={describeError(error)} />;
  }

  if (!chat) return <SettingsSubpageSkeleton />;

  return (
    <div className="space-y-6 py-4">
      <PageHeader back={<platform.BackLink href={backHref} />} title="Telegram 群組" />
      <TelegramChatSettings groupId={id} chat={chat} onUnlinkConflict={() => refetch()} />
    </div>
  );
}
