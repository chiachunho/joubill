"use client";

import { GroupRefundEditPage } from "@/components/pages/GroupRefundPage";
import { webPlatform } from "@/components/pages/platform.web";

export default function EditRefundPage({
  params,
}: {
  params: Promise<{ id: string; refundId: string }>;
}) {
  return <GroupRefundEditPage params={params} platform={webPlatform} />;
}
