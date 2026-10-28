"use client";

import { GroupStatsPage } from "@/components/pages/GroupStatsPage";
import { webPlatform } from "@/components/pages/platform";

export default function AppStatsPage({ params }: { params: Promise<{ id: string }> }) {
  return <GroupStatsPage params={params} platform={webPlatform} />;
}
