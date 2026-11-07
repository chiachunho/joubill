"use client";

import { McpConnectionPage } from "@/components/pages/McpConnectionPage";
import { miniPlatform } from "@/components/pages/platform.mini";

export default function MiniMcpConnectionPage({ params }: { params: Promise<{ id: string }> }) {
  return <McpConnectionPage params={params} platform={miniPlatform} />;
}
