"use client";

import { GroupSettings } from "@/components/pages/GroupSettings";
import { webPlatform } from "@/components/pages/platform";

export default function AppGroupSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  return <GroupSettings params={params} platform={webPlatform} />;
}
