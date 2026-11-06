"use client";

import { OAuthConsentPage } from "@/components/pages/OAuthConsentPage";
import { webPlatform } from "@/components/pages/platform.web";

export default function AppOAuthConsentPage() {
  return <OAuthConsentPage platform={webPlatform} />;
}
