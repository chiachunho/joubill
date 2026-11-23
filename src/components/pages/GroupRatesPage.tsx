"use client";

import { use, useState } from "react";
import { Clock, Coins } from "lucide-react";

import { PageHeader } from "@/components/mini/PageHeader";
import { Panel } from "@/components/mini/Panel";
import { ConfirmDialog } from "@/components/mini/ConfirmDialog";
import { IconTile } from "@/components/mini/IconTile";
import { CustomRatesSection } from "@/components/mini/CustomRatesSection";
import { SettingsSubpageSkeleton } from "@/components/mini/skeletons";
import { TimeZoneSelect } from "@/components/mini/TimeZoneSelect";
import { LoadError } from "@/components/mini/LoadError";
import type { Platform } from "@/components/pages/platform";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { describeError } from "@/lib/api-error";
import { describeTimeZone, TIMEZONE_PURPOSE } from "@/lib/timezone";
import { SUPPORTED_CURRENCIES } from "@/lib/zod";
import {
  useGetSettingsQuery,
  useUpdateGroupCurrencyMutation,
  useUpdateGroupTimezoneMutation,
} from "@/store/api";

/**
 * 貨幣與匯率: the one page behind the group settings row of the same name. 預設貨幣 and 時區 sit
 * on top, and the group's 自訂匯率 are listed right below them rather than on a page of their own.
 */
export function GroupRatesPage({
  params,
  platform,
}: {
  params: Promise<{ id: string }>;
  platform: Platform;
}) {
  const { id } = use(params);

  const backHref = `${platform.basePath}/groups/${id}/settings`;
  platform.useBack(backHref);

  const { data: settings, error } = useGetSettingsQuery(id);
  const [updateGroupCurrency] = useUpdateGroupCurrencyMutation();
  const [updateGroupTimezone] = useUpdateGroupTimezoneMutation();

  const [currencyPending, setCurrencyPending] = useState(false);
  const [pendingCurrency, setPendingCurrency] = useState<string | null>(null);
  const [timezonePending, setTimezonePending] = useState(false);
  const [pendingTimezone, setPendingTimezone] = useState<string | null>(null);

  async function updateCurrency(currency: string) {
    if (currencyPending) return;
    setCurrencyPending(true);
    try {
      // The select shows the new currency at once; the mutation puts it back on failure.
      await updateGroupCurrency({ groupId: id, defaultCurrency: currency }).unwrap();
    } catch {
      // rolled back
    } finally {
      setCurrencyPending(false);
    }
  }

  async function updateTimezone(timezone: string) {
    if (timezonePending) return;
    setTimezonePending(true);
    try {
      // The select shows the new zone at once; the mutation puts it back on failure.
      await updateGroupTimezone({ groupId: id, timezone }).unwrap();
    } catch {
      // rolled back
    } finally {
      setTimezonePending(false);
    }
  }

  if (error) {
    return <LoadError detail={describeError(error)} />;
  }

  if (!settings) {
    return <SettingsSubpageSkeleton />;
  }

  return (
    <div className="space-y-6 py-4">
      <PageHeader back={<platform.BackLink href={backHref} />} title="貨幣與匯率" />

      <section className="px-4">
        <Panel>
          <div className="flex items-center gap-3 px-4 py-3">
            <IconTile icon={Coins} />
            <span className="flex-1 text-sm">預設貨幣</span>
            <Select
              value={settings.defaultCurrency}
              onValueChange={(c) => {
                if (c !== settings.defaultCurrency) setPendingCurrency(c);
              }}
              disabled={currencyPending}
            >
              <SelectTrigger className="h-8 w-24 border-0 bg-background/60">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SUPPORTED_CURRENCIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2 px-4 py-3">
            <div className="flex items-center gap-3">
              <IconTile icon={Clock} />
              <span className="flex-1 text-sm">時區</span>
              <div className="w-56 max-w-[60%]">
                <TimeZoneSelect
                  value={settings.timezone}
                  disabled={timezonePending}
                  className="h-8 rounded-lg border-0 bg-background/60 text-sm"
                  onChange={(tz) => {
                    if (tz !== settings.timezone) setPendingTimezone(tz);
                  }}
                />
              </div>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">{TIMEZONE_PURPOSE}</p>
          </div>
        </Panel>
      </section>

      <div>
        <p className="sect mb-2.5 px-4">自訂匯率</p>
        <CustomRatesSection groupId={id} defaultCurrency={settings.defaultCurrency} />
      </div>

      <ConfirmDialog
        open={pendingCurrency !== null}
        onOpenChange={(open) => {
          if (!open) setPendingCurrency(null);
        }}
        title="變更預設貨幣"
        description={
          pendingCurrency
            ? `整本帳會改以 ${pendingCurrency} 計算：餘額與統計將以市場匯率重新換算，現有的群組自訂匯率與單筆自訂匯率會暫停生效（改回原貨幣時恢復）。`
            : undefined
        }
        confirmLabel="變更"
        loading={currencyPending}
        onConfirm={async () => {
          if (!pendingCurrency) return;
          await updateCurrency(pendingCurrency);
          setPendingCurrency(null);
        }}
      />

      <ConfirmDialog
        open={pendingTimezone !== null}
        onOpenChange={(open) => {
          if (!open) setPendingTimezone(null);
        }}
        title="變更群組時區"
        description={
          pendingTimezone
            ? `要把群組時區改成 ${describeTimeZone(pendingTimezone)} 嗎？整個群組都會跟著改。${TIMEZONE_PURPOSE}`
            : undefined
        }
        confirmLabel="變更"
        loading={timezonePending}
        onConfirm={async () => {
          if (!pendingTimezone) return;
          await updateTimezone(pendingTimezone);
          setPendingTimezone(null);
        }}
      />
    </div>
  );
}
