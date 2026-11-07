"use client";

import { useState } from "react";

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
  className,
}: {
  value: string;
  onChange: (timeZone: string) => void;
  disabled?: boolean;
  ariaLabel?: string;
  /** Extra classes for the trigger, e.g. to match a neighbouring inline select. */
  className?: string;
}) {
  // ~400 zones, each described with an Intl lookup: only built once the list is opened. The
  // chosen zone is always an item, so the closed trigger can still show it.
  const [open, setOpen] = useState(false);
  const now = new Date();
  const common = new Set(COMMON_TIME_ZONES.map((z) => z.tz));
  const others = open
    ? supportedTimeZones().filter((tz) => !common.has(tz))
    : common.has(value)
      ? []
      : [value];
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled} onOpenChange={setOpen}>
      <SelectTrigger aria-label={ariaLabel} className={className}>
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
