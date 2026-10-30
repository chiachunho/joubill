"use client";

import { JoinByCodePage } from "@/components/pages/JoinByCodePage";
import { miniPlatform } from "@/components/pages/platform.mini";

export default function MiniJoinByCodePage() {
  return <JoinByCodePage platform={miniPlatform} />;
}
