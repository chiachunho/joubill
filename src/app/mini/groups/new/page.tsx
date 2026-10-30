"use client";

import { GroupCreatePage } from "@/components/pages/GroupCreatePage";
import { miniPlatform } from "@/components/pages/platform.mini";

export default function MiniGroupCreatePage() {
  return <GroupCreatePage platform={miniPlatform} />;
}
