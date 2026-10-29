"use client";

import { PersonalSettings } from "@/components/pages/PersonalSettings";
import { webPlatform } from "@/components/pages/platform.web";

export default function AppSettingsPage() {
  return <PersonalSettings platform={webPlatform} />;
}
