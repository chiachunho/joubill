"use client";

import { GroupDetailPage } from "@/components/pages/GroupDetailPage";
import { webPlatform } from "@/components/pages/platform";

export default function AppGroupPage({ params }: { params: Promise<{ id: string }> }) {
  return <GroupDetailPage params={params} platform={webPlatform} />;
}
