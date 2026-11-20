"use client";

import { GroupRefundNewPage } from "@/components/pages/GroupRefundPage";
import { webPlatform } from "@/components/pages/platform.web";

export default function NewRefundPage({
  params,
}: {
  params: Promise<{ id: string; expenseId: string }>;
}) {
  return <GroupRefundNewPage params={params} platform={webPlatform} />;
}
