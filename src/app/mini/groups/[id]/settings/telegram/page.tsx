"use client";

import { GroupTelegramPage } from "@/components/pages/GroupTelegramPage";
import { miniPlatform } from "@/components/pages/platform.mini";

export default function GroupTelegramSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  return <GroupTelegramPage params={params} platform={miniPlatform} />;
}
