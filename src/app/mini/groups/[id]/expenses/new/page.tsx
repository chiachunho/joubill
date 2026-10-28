"use client";

import { GroupExpenseNewPage } from "@/components/pages/GroupExpenseNewPage";
import { miniPlatform } from "@/components/pages/platform";

export default function NewExpensePage({ params }: { params: Promise<{ id: string }> }) {
  return <GroupExpenseNewPage params={params} platform={miniPlatform} />;
}
