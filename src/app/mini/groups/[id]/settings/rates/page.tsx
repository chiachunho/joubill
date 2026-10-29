"use client";

import { GroupRatesPage } from "@/components/pages/GroupRatesPage";
import { miniPlatform } from "@/components/pages/platform.mini";

export default function GroupRatesSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  return <GroupRatesPage params={params} platform={miniPlatform} />;
}
