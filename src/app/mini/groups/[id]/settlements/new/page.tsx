"use client";

import { GroupSettlementNewPage } from "@/components/pages/GroupSettlementNewPage";
import { miniPlatform } from "@/components/pages/platform";

export default function NewSettlementPage({ params }: { params: Promise<{ id: string }> }) {
  return <GroupSettlementNewPage params={params} platform={miniPlatform} />;
}
