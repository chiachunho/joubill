"use client";

import { LinkedAppsPage } from "@/components/pages/LinkedAppsPage";
import { miniPlatform } from "@/components/pages/platform.mini";

export default function MiniLinkedAppsPage() {
  return <LinkedAppsPage platform={miniPlatform} />;
}
