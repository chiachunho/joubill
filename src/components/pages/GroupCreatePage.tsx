"use client";

import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";

import type { Platform } from "@/components/pages/platform";
import { useLoginRedirect } from "@/components/pages/use-login-redirect";
import { TimeZoneSelect } from "@/components/mini/TimeZoneSelect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiErrorText } from "@/lib/api-error";
import {
  DEFAULT_TIME_ZONE,
  deviceTimeZone,
  TIMEZONE_PURPOSE,
  timeZoneOrDefault,
} from "@/lib/timezone";
import { SUPPORTED_CURRENCIES } from "@/lib/zod";
import { useCreateGroupMutation } from "@/store/api";

/** The device zone never changes while the page is open, so there is nothing to subscribe to. */
function subscribeNever(): () => void {
  return () => {};
}

/** 建立群組: a group with no Telegram chat, and the creator as its first member. */
export function GroupCreatePage({ platform }: { platform: Platform }) {
  const router = useRouter();
  platform.useBack(platform.basePath);
  const [title, setTitle] = useState("");
  const [currency, setCurrency] = useState("TWD");
  // The device's zone is the likeliest right answer (a trip is usually created where it
  // happens), and it is also what keeps 群組頁 from asking about it the first time. Read as an
  // external store so the server render and the first client render agree, then it swaps in.
  const deviceZone = useSyncExternalStore(
    subscribeNever,
    () => timeZoneOrDefault(deviceTimeZone()),
    () => DEFAULT_TIME_ZONE,
  );
  const [pickedZone, setPickedZone] = useState<string | null>(null);
  const timezone = pickedZone ?? deviceZone;
  const [createGroup, { isLoading, error }] = useCreateGroupMutation();
  useLoginRedirect(error, platform.loginPath);

  const trimmed = title.trim();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!trimmed || isLoading) return;
    try {
      const { id } = await createGroup({
        title: trimmed,
        defaultCurrency: currency,
        timezone,
      }).unwrap();
      router.replace(`${platform.basePath}/groups/${id}`);
    } catch {
      // Shown below from the mutation's error.
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5 px-4 py-4">
      <div>
        <platform.BackLink href={platform.basePath} />
        <h1 className="text-lg font-semibold">建立群組</h1>
      </div>

      <label className="block space-y-2">
        <span className="sect">群組名稱</span>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={50}
          placeholder="例如：東京旅行"
          autoFocus
        />
      </label>

      <div className="space-y-2">
        <span className="sect">預設幣別</span>
        <Select value={currency} onValueChange={setCurrency}>
          <SelectTrigger aria-label="預設幣別">
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

      <div className="space-y-2">
        <span className="sect">時區</span>
        <TimeZoneSelect value={timezone} onChange={setPickedZone} />
        <p className="text-xs leading-relaxed text-muted-foreground">
          預設為你的裝置時區。{TIMEZONE_PURPOSE}建立後可在群組設定修改。
        </p>
      </div>

      {error && (
        <p className="text-sm text-destructive">{apiErrorText(error, "建立失敗，請再試一次")}</p>
      )}

      <Button type="submit" className="w-full" disabled={!trimmed || isLoading}>
        {isLoading ? "建立中…" : "建立群組"}
      </Button>
    </form>
  );
}
