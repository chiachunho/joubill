"use client";

import { McpPage } from "@/components/pages/McpPage";
import { miniPlatform } from "@/components/pages/platform.mini";

export default function MiniMcpPage() {
  return <McpPage platform={miniPlatform} />;
}
