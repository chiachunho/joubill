"use client";

import { GroupBeancountExportPage } from "@/components/pages/GroupBeancountExportPage";
import { webPlatform } from "@/components/pages/platform.web";

export default function AppGroupBeancountExportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return <GroupBeancountExportPage params={params} platform={webPlatform} />;
}
