"use client";

import { GroupSettings } from "@/components/pages/GroupSettings";
import { webPlatform } from "@/components/pages/platform.web";

export default function AppGroupSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  return <GroupSettings params={params} platform={webPlatform} />;
}
