"use client";

import { McpConnectionCallsPage } from "@/components/pages/McpConnectionCallsPage";
import { miniPlatform } from "@/components/pages/platform.mini";

export default function MiniMcpConnectionCallsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return <McpConnectionCallsPage params={params} platform={miniPlatform} />;
}
