"use client";

import { GroupStatsPage } from "@/components/pages/GroupStatsPage";
import { miniPlatform } from "@/components/pages/platform.mini";

export default function StatsPage({ params }: { params: Promise<{ id: string }> }) {
  return <GroupStatsPage params={params} platform={miniPlatform} />;
}
