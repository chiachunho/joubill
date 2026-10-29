"use client";

import { GroupsHome } from "@/components/pages/GroupsHome";
import { miniPlatform } from "@/components/pages/platform.mini";

export default function MiniHome() {
  return <GroupsHome platform={miniPlatform} />;
}
