"use client";

import { GroupExpenseEditPage } from "@/components/pages/GroupExpenseEditPage";
import { miniPlatform } from "@/components/pages/platform.mini";

export default function EditExpensePage({
  params,
}: {
  params: Promise<{ id: string; expenseId: string }>;
}) {
  return <GroupExpenseEditPage params={params} platform={miniPlatform} />;
}
