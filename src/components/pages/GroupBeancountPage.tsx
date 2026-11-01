"use client";

import { use } from "react";

import { BeancountSettingsSection } from "@/components/mini/BeancountSettingsSection";
import type { Platform } from "@/components/pages/platform";

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

  return (
    <div className="space-y-6 py-4">
      <div className="px-4">
        <platform.BackLink href={backHref} />
        <h1 className="text-lg font-semibold">Beancount 帳戶設定</h1>
      </div>

      <BeancountSettingsSection groupId={id} />
    </div>
  );
}
