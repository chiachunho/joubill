"use client";

import { GroupBeancountPage } from "@/components/pages/GroupBeancountPage";
import { miniPlatform } from "@/components/pages/platform";

export default function GroupBeancountSettingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return <GroupBeancountPage params={params} platform={miniPlatform} />;
}
