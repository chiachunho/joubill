"use client";

import { GroupExpenseEditPage } from "@/components/pages/GroupExpenseEditPage";
import { webPlatform } from "@/components/pages/platform";

export default function AppEditExpensePage({
  params,
}: {
  params: Promise<{ id: string; expenseId: string }>;
}) {
  return <GroupExpenseEditPage params={params} platform={webPlatform} />;
}
