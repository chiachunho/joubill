"use client";

import { GroupExpenseNewPage } from "@/components/pages/GroupExpenseNewPage";
import { webPlatform } from "@/components/pages/platform";

export default function AppNewExpensePage({ params }: { params: Promise<{ id: string }> }) {
  return <GroupExpenseNewPage params={params} platform={webPlatform} />;
}
