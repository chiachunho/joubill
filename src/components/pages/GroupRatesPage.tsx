"use client";

import { use } from "react";
import useSWR from "swr";

import { CustomRatesSection } from "@/components/mini/CustomRatesSection";
import { SettingsSubpageSkeleton } from "@/components/mini/skeletons";
import type { Platform } from "@/components/pages/platform";

type SettingsResponse = { defaultCurrency: string };

export function GroupRatesPage({
  params,
  platform,
}: {
  params: Promise<{ id: string }>;
  platform: Platform;
}) {
  const { id } = use(params);

  const backHref = `${platform.basePath}/groups/${id}/settings`;
  platform.useBack(backHref);

  const { data: settings, error } = useSWR<SettingsResponse>(`/api/groups/${id}/settings`);

  if (error) {
    return (
      <div className="px-4 py-12 text-center">
        <p className="text-sm text-muted-foreground">無法載入</p>
        <p className="mt-1 text-xs text-muted-foreground/60">{String(error)}</p>
      </div>
    );
  }

  if (!settings) {
    return <SettingsSubpageSkeleton />;
  }

  return (
    <div className="space-y-6 py-4">
      <div className="px-4">
        <platform.BackLink href={backHref} />
        <h1 className="text-lg font-semibold">自訂匯率</h1>
      </div>

      <CustomRatesSection
        groupId={id}
        defaultCurrency={settings.defaultCurrency}
        rawFetch={platform.rawRequest}
      />
    </div>
  );
}
