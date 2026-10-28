"use client";

import { GroupSettlementNewPage } from "@/components/pages/GroupSettlementNewPage";
import { webPlatform } from "@/components/pages/platform";

export default function AppNewSettlementPage({ params }: { params: Promise<{ id: string }> }) {
  return <GroupSettlementNewPage params={params} platform={webPlatform} />;
}
