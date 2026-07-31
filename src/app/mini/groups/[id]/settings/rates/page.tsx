"use client";

import { use, useCallback } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";

import { CustomRatesSection } from "@/components/mini/CustomRatesSection";
import { SettingsSubpageSkeleton } from "@/components/mini/skeletons";
import { tmaRawFetch } from "@/lib/web-fetch";
import { useTelegramBackButton } from "@/lib/use-tg-back-button";

type SettingsResponse = { defaultCurrency: string };

export default function GroupRatesSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  const back = useCallback(() => router.push(`/mini/groups/${id}/settings`), [router, id]);
  useTelegramBackButton(back);

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
        <h1 className="text-lg font-semibold">自訂匯率</h1>
      </div>

      <CustomRatesSection
        groupId={id}
        defaultCurrency={settings.defaultCurrency}
        rawFetch={tmaRawFetch}
      />
    </div>
  );
}
