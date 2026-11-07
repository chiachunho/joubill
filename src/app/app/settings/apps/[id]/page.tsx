"use client";

import { McpConnectionPage } from "@/components/pages/McpConnectionPage";
import { webPlatform } from "@/components/pages/platform.web";

export default function AppMcpConnectionPage({ params }: { params: Promise<{ id: string }> }) {
  return <McpConnectionPage params={params} platform={webPlatform} />;
}
