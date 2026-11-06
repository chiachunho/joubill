"use client";

import { LinkedAppsPage } from "@/components/pages/LinkedAppsPage";
import { webPlatform } from "@/components/pages/platform.web";

export default function AppLinkedAppsPage() {
  return <LinkedAppsPage platform={webPlatform} />;
}
