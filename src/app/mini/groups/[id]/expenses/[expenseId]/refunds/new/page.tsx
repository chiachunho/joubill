"use client";

import { GroupRefundNewPage } from "@/components/pages/GroupRefundPage";
import { miniPlatform } from "@/components/pages/platform.mini";

export default function NewRefundPage({
  params,
}: {
  params: Promise<{ id: string; expenseId: string }>;
}) {
  return <GroupRefundNewPage params={params} platform={miniPlatform} />;
}
