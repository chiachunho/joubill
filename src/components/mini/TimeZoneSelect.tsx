"use client";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { COMMON_TIME_ZONES, describeTimeZone, supportedTimeZones } from "@/lib/timezone";

/**
 * A group's time zone, picked from the IANA names the runtime knows (the same list the API
 * validates against). The common cities come first; every offset is the zone's current one.
 */
export function TimeZoneSelect({
  value,
  onChange,
  disabled,
  ariaLabel = "時區",
}: {
  value: string;
  onChange: (timeZone: string) => void;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const common = new Set(COMMON_TIME_ZONES.map((z) => z.tz));
  const others = supportedTimeZones().filter((tz) => !common.has(tz));
  const now = new Date();
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger aria-label={ariaLabel}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>常用</SelectLabel>
          {COMMON_TIME_ZONES.map((z) => (
            <SelectItem key={z.tz} value={z.tz}>
              {describeTimeZone(z.tz, now)}
            </SelectItem>
          ))}
        </SelectGroup>
        <SelectSeparator />
        <SelectGroup>
          <SelectLabel>全部</SelectLabel>
          {others.map((tz) => (
            <SelectItem key={tz} value={tz}>
              {describeTimeZone(tz, now)}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
