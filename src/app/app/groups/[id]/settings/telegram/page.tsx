"use client";

import { GroupTelegramPage } from "@/components/pages/GroupTelegramPage";
import { webPlatform } from "@/components/pages/platform.web";

export default function AppGroupTelegramSettingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return <GroupTelegramPage params={params} platform={webPlatform} />;
}
