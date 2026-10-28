"use client";

import { GroupBeancountPage } from "@/components/pages/GroupBeancountPage";
import { webPlatform } from "@/components/pages/platform";

export default function AppGroupBeancountSettingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return <GroupBeancountPage params={params} platform={webPlatform} />;
}
