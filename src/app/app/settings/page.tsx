"use client";

import { PersonalSettings } from "@/components/pages/PersonalSettings";
import { webPlatform } from "@/components/pages/platform";

export default function AppSettingsPage() {
  return <PersonalSettings platform={webPlatform} />;
}
