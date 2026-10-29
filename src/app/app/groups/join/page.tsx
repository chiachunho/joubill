"use client";

import { JoinByCodePage } from "@/components/pages/JoinByCodePage";
import { webPlatform } from "@/components/pages/platform.web";

export default function AppJoinByCodePage() {
  return <JoinByCodePage platform={webPlatform} />;
}
