"use client";

import { GroupSettings } from "@/components/pages/GroupSettings";
import { miniPlatform } from "@/components/pages/platform";

export default function GroupSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  return <GroupSettings params={params} platform={miniPlatform} />;
}
