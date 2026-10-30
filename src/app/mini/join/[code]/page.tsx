"use client";

import { JoinPage } from "@/components/pages/JoinPage";
import { miniPlatform } from "@/components/pages/platform.mini";

export default function MiniJoinCodePage({ params }: { params: Promise<{ code: string }> }) {
  return <JoinPage params={params} platform={miniPlatform} />;
}
