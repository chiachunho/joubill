"use client";

import { AccountMergePage } from "@/components/pages/AccountMergePage";

// Web App only: the merge starts from an OAuth sign-in, which can't run in the Mini App.
export default function AppAccountMergePage() {
  return <AccountMergePage />;
}
