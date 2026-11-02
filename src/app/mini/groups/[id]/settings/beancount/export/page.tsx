"use client";

import { GroupBeancountExportPage } from "@/components/pages/GroupBeancountExportPage";
import { miniPlatform } from "@/components/pages/platform.mini";

export default function MiniGroupBeancountExportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return <GroupBeancountExportPage params={params} platform={miniPlatform} />;
}
