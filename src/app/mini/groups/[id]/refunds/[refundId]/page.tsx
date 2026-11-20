"use client";

import { GroupRefundEditPage } from "@/components/pages/GroupRefundPage";
import { miniPlatform } from "@/components/pages/platform.mini";

export default function EditRefundPage({
  params,
}: {
  params: Promise<{ id: string; refundId: string }>;
}) {
  return <GroupRefundEditPage params={params} platform={miniPlatform} />;
}
