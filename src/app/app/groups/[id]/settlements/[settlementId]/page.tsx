"use client";

import { GroupSettlementEditPage } from "@/components/pages/GroupSettlementEditPage";
import { webPlatform } from "@/components/pages/platform.web";

export default function AppEditSettlementPage({
  params,
}: {
  params: Promise<{ id: string; settlementId: string }>;
}) {
  return <GroupSettlementEditPage params={params} platform={webPlatform} />;
}
