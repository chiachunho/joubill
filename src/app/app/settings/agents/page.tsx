"use client";

import { AgentsPage } from "@/components/pages/AgentsPage";
import { webPlatform } from "@/components/pages/platform.web";

export default function AppAgentsPage() {
  return <AgentsPage platform={webPlatform} />;
}
