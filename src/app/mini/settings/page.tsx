"use client";

import { PersonalSettings } from "@/components/pages/PersonalSettings";
import { miniPlatform } from "@/components/pages/platform.mini";

export default function PersonalSettingsPage() {
  return <PersonalSettings platform={miniPlatform} />;
}
