"use client";

import { GroupActivityPage } from "@/components/pages/GroupActivityPage";
import { miniPlatform } from "@/components/pages/platform";

export default function ActivityPage({ params }: { params: Promise<{ id: string }> }) {
  return <GroupActivityPage params={params} platform={miniPlatform} />;
}
