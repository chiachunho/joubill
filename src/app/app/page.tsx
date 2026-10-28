"use client";

import { GroupsHome } from "@/components/pages/GroupsHome";
import { webPlatform } from "@/components/pages/platform";

export default function AppHome() {
  return <GroupsHome platform={webPlatform} />;
}
