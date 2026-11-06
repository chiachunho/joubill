"use client";

import { McpPage } from "@/components/pages/McpPage";
import { webPlatform } from "@/components/pages/platform.web";

export default function AppMcpPage() {
  return <McpPage platform={webPlatform} />;
}
