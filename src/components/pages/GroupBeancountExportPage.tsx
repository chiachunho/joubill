"use client";

import { use } from "react";

import { BeancountExportSection } from "@/components/mini/BeancountExportSection";
import type { Platform } from "@/components/pages/platform";

export function GroupBeancountExportPage({
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
        <h1 className="text-lg font-semibold">匯出 beancount</h1>
      </div>

      <BeancountExportSection groupId={id} platform={platform} />
    </div>
  );
}
