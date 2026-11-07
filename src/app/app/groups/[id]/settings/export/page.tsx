"use client";

import { GroupExportPage } from "@/components/pages/GroupExportPage";
import { webPlatform } from "@/components/pages/platform.web";

export default function AppGroupExportSettingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return <GroupExportPage params={params} platform={webPlatform} />;
}
