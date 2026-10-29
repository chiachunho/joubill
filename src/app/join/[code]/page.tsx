"use client";

import { JoinPage } from "@/components/pages/JoinPage";
import { webPlatform } from "@/components/pages/platform.web";

export default function JoinCodePage({ params }: { params: Promise<{ code: string }> }) {
  return <JoinPage params={params} platform={webPlatform} />;
}
