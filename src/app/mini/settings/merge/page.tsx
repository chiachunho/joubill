"use client";

import { AccountMergePage } from "@/components/pages/AccountMergePage";
import { miniPlatform } from "@/components/pages/platform.mini";

export default function MiniAccountMergePage() {
  return <AccountMergePage platform={miniPlatform} />;
}
