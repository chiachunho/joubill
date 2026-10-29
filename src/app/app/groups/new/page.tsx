"use client";

import { GroupCreatePage } from "@/components/pages/GroupCreatePage";
import { webPlatform } from "@/components/pages/platform.web";

export default function AppGroupCreatePage() {
  return <GroupCreatePage platform={webPlatform} />;
}
