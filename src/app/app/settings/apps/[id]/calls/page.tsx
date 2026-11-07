"use client";

import { McpConnectionCallsPage } from "@/components/pages/McpConnectionCallsPage";
import { webPlatform } from "@/components/pages/platform.web";

export default function AppMcpConnectionCallsPage({ params }: { params: Promise<{ id: string }> }) {
  return <McpConnectionCallsPage params={params} platform={webPlatform} />;
}
