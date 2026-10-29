"use client";

import { GroupActivityPage } from "@/components/pages/GroupActivityPage";
import { webPlatform } from "@/components/pages/platform.web";

export default function AppActivityPage({ params }: { params: Promise<{ id: string }> }) {
  return <GroupActivityPage params={params} platform={webPlatform} />;
}
