"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useLocalPref } from "@/lib/use-local-pref";
import {
  describeTimeZone,
  deviceTimeZone as readDeviceTimeZone,
  shouldPromptTimezone,
  TIMEZONE_PURPOSE,
  timezonePromptKey,
} from "@/lib/timezone";
import { useGetSettingsQuery, useUpdateGroupTimezoneMutation } from "@/store/api";

/**
 * Asks, on the group page only, whether to switch the group to this device's time zone when
 * the two sit at different UTC offsets. 不用 is remembered on this device per group and per
 * device zone, so travelling to a new zone asks once more and nothing else does.
 */
export function TimezonePrompt({ groupId }: { groupId: string }) {
  const { data: settings } = useGetSettingsQuery(groupId);
  const [updateTimezone] = useUpdateGroupTimezoneMutation();
  const [failed, setFailed] = useState(false);
  const deviceTimeZone = readDeviceTimeZone();
  const [dismissed, setDismissed] = useLocalPref(timezonePromptKey(groupId, deviceTimeZone));

  if (
    !settings ||
    !shouldPromptTimezone({
      deviceTimeZone,
      groupTimeZone: settings.timezone,
      dismissed: dismissed !== null,
    })
  ) {
    return null;
  }

  async function accept() {
    setFailed(false);
    try {
      await updateTimezone({ groupId, timezone: deviceTimeZone }).unwrap();
    } catch {
      setFailed(true);
    }
  }

  return (
    <section className="px-4">
      <div className="space-y-3 rounded-2xl bg-secondary/50 px-4 py-3 text-sm">
        <p className="leading-relaxed">
          你的裝置時區是 <b>{describeTimeZone(deviceTimeZone)}</b>，這個群組目前是{" "}
          <b>{describeTimeZone(settings.timezone)}</b>。要改成 {deviceTimeZone} 嗎？
        </p>
        <p className="text-xs text-muted-foreground">{TIMEZONE_PURPOSE}</p>
        {failed && <p className="text-xs text-destructive">更新失敗，請再試一次</p>}
        <div className="flex gap-2">
          <Button size="sm" onClick={accept}>
            改成 {deviceTimeZone}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setDismissed("1")}>
            不用
          </Button>
        </div>
      </div>
    </section>
  );
}
