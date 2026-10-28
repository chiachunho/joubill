"use client";

import { GroupDetailPage } from "@/components/pages/GroupDetailPage";
import { miniPlatform } from "@/components/pages/platform";

export default function GroupPage({ params }: { params: Promise<{ id: string }> }) {
  return <GroupDetailPage params={params} platform={miniPlatform} />;
}
