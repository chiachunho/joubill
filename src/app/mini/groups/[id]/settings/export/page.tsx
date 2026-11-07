"use client";

import { GroupExportPage } from "@/components/pages/GroupExportPage";
import { miniPlatform } from "@/components/pages/platform.mini";

export default function GroupExportSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  return <GroupExportPage params={params} platform={miniPlatform} />;
}
