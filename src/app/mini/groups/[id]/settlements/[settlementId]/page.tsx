"use client";

import { GroupSettlementEditPage } from "@/components/pages/GroupSettlementEditPage";
import { miniPlatform } from "@/components/pages/platform.mini";

export default function EditSettlementPage({
  params,
}: {
  params: Promise<{ id: string; settlementId: string }>;
}) {
  return <GroupSettlementEditPage params={params} platform={miniPlatform} />;
}
