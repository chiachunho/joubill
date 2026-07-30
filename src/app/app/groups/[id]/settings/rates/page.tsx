"use client";

import { use } from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import useSWR from "swr";

import { CustomRatesSection } from "@/components/mini/CustomRatesSection";
import { SettingsSubpageSkeleton } from "@/components/mini/skeletons";
import { webRawFetch } from "@/lib/web-fetch";

type SettingsResponse = { defaultCurrency: string };

export default function AppGroupRatesSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

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
      <div className="flex items-center gap-2 px-4">
        <Link
          href={`/app/groups/${id}/settings`}
          className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
        </Link>
        <h1 className="text-lg font-semibold">自訂匯率</h1>
      </div>

      <CustomRatesSection
        groupId={id}
        defaultCurrency={settings.defaultCurrency}
        rawFetch={webRawFetch}
      />
    </div>
  );
}
