"use client";

import { use } from "react";

import { BeancountSettingsSection } from "@/components/mini/BeancountSettingsSection";
import { SettingsSubpageSkeleton } from "@/components/mini/skeletons";
import type { Platform } from "@/components/pages/platform";
import { describeError } from "@/lib/api-error";
import { useGetMembersQuery } from "@/store/api";

export function GroupBeancountPage({
  params,
  platform,
}: {
  params: Promise<{ id: string }>;
  platform: Platform;
}) {
  const { id } = use(params);

  const backHref = `${platform.basePath}/groups/${id}/settings`;
  platform.useBack(backHref);

  const { data: membersData, error } = useGetMembersQuery(id);

  if (error) {
    return (
      <div className="px-4 py-12 text-center">
        <p className="text-sm text-muted-foreground">無法載入</p>
        <p className="mt-1 text-xs text-muted-foreground/60">{describeError(error)}</p>
      </div>
    );
  }

  if (!membersData) {
    return <SettingsSubpageSkeleton />;
  }

  return (
    <div className="space-y-6 py-4">
      <div className="px-4">
        <platform.BackLink href={backHref} />
        <h1 className="text-lg font-semibold">Beancount 帳戶名稱設定</h1>
      </div>

      <BeancountSettingsSection groupId={id} members={membersData.members} />
    </div>
  );
}
