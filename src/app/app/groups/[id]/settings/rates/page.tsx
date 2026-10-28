"use client";

import { GroupRatesPage } from "@/components/pages/GroupRatesPage";
import { webPlatform } from "@/components/pages/platform";

export default function AppGroupRatesSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  return <GroupRatesPage params={params} platform={webPlatform} />;
}
