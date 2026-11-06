"use client";

import { AgentsPage } from "@/components/pages/AgentsPage";
import { miniPlatform } from "@/components/pages/platform.mini";

export default function MiniAgentsPage() {
  return <AgentsPage platform={miniPlatform} />;
}
