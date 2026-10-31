"use client";

import { useState } from "react";
import { Bean, Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  recordToBeancount,
  type BeancountAccounts,
  type BeancountFx,
  type BeancountRecord,
} from "@/lib/beancount";
import type { Profile } from "@/lib/label";
import { useGetBeancountConfigQuery, useLazyGetEffectiveRateQuery } from "@/store/api";

type Member = {
  id: number;
  displayName: string | null;
  firstName: string | null;
  lastName?: string | null;
  username: string | null;
};

type Props = {
  record: BeancountRecord;
  /** Per-record pinned rate (if any) and the currency it was stamped against. */
  fxRate: number | null;
  fxQuote: string | null;
  currentUserId: number;
  members: Member[];
  groupId: number;
  defaultCurrency: string;
};

async function copyText(text: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // fall through to the legacy textarea path
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand("copy");
  } finally {
    document.body.removeChild(ta);
  }
}

export function CopyBeancountButton({
  record,
  fxRate,
  fxQuote,
  currentUserId,
  members,
  groupId,
  defaultCurrency,
}: Props) {
  const [copied, setCopied] = useState(false);
  // The feature is opt-in per (user, group): no config row → button stays hidden.
  const { data } = useGetBeancountConfigQuery(groupId);
  const [fetchEffectiveRate] = useLazyGetEffectiveRateQuery();

  // Resolve the rate to convert the record into the group default currency,
  // mirroring fx.ts priority: per-record pin → group/market (via the effective
  // endpoint). Returns null when no conversion is needed.
  async function resolveFx(): Promise<BeancountFx> {
    if (record.currency === defaultCurrency) return null;
    if (fxRate != null && fxQuote === defaultCurrency) {
      return { quote: defaultCurrency, rate: fxRate };
    }
    const date = new Date(record.spentAt).toISOString().slice(0, 10);
    try {
      const data = await fetchEffectiveRate(
        { groupId, base: record.currency, date },
        true,
      ).unwrap();
      return { quote: defaultCurrency, rate: typeof data.rate === "number" ? data.rate : null };
    } catch {
      // network/parse failure → fall through to "rate unavailable"
    }
    return { quote: defaultCurrency, rate: null };
  }

  const config = data?.config ?? null;

  async function handleCopy() {
    if (!config) return;
    const peopleById = new Map<number, Profile>(
      members.map((m) => [
        m.id,
        {
          userId: m.id,
          displayName: m.displayName,
          firstName: m.firstName,
          lastName: m.lastName ?? null,
          username: m.username,
        },
      ]),
    );
    const accounts: BeancountAccounts = {
      expenses: config.expensesAccount,
      cash: config.cashAccount,
      receivablePrefix: config.receivablePrefix,
      personAccounts: config.personAccounts,
    };
    const fx = await resolveFx();
    await copyText(recordToBeancount(record, currentUserId, peopleById, fx, accounts));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  // Hidden until the user enables the feature for this group.
  if (!config) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="shrink-0 rounded-lg"
          onClick={handleCopy}
          aria-label="複製 beancount 語法"
        >
          {copied ? <Check className="size-4" /> : <Bean className="size-4" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>複製 beancount 語法</TooltipContent>
    </Tooltip>
  );
}
