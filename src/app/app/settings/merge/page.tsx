"use client";

import { AccountMergePage } from "@/components/pages/AccountMergePage";
import { webPlatform } from "@/components/pages/platform.web";

export default function AppAccountMergePage() {
  return <AccountMergePage platform={webPlatform} />;
}
