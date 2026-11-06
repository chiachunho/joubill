"use client";

import { OAuthConsentPage } from "@/components/pages/OAuthConsentPage";
import { miniPlatform } from "@/components/pages/platform.mini";

export default function MiniOAuthConsentPage() {
  return <OAuthConsentPage platform={miniPlatform} />;
}
