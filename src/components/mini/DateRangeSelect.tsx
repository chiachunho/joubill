"use client";

import { useState } from "react";
import { Calendar as CalendarIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { StatsRangeKey } from "@/lib/stats-core";
import { parseLocalDay } from "@/lib/stats-core";

export type StatsRangeValue = {
  key: StatsRangeKey;
  /** "YYYY-MM-DD", only meaningful (and only both set once picked) when key === "custom". */
  from?: string;
  to?: string;
};

/** Single source of truth for range labels — also imported by the stats
 *  pages for their "· 6 個月" badges, so a rename can't drift between the
 *  dropdown text and the chart headers. */
export const RANGE_LABELS: Record<StatsRangeKey, string> = {
  "3m": "3 個月",
  "6m": "6 個月",
  "1y": "1 年",
  all: "全部",
  custom: "自訂區間",
};

const PRESET_KEYS: Array<Exclude<StatsRangeKey, "custom">> = ["3m", "6m", "1y", "all"];

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

type Props = {
  value: StatsRangeValue;
  onChange: (value: StatsRangeValue) => void;
};

/** Range dropdown for the stats page: four presets plus a custom from/to
 *  picker. Shared by /mini and /app so the two hand-maintained page copies
 *  don't drift on how a range is represented. */
export function DateRangeSelect({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div className="space-y-2">
      <Select
        value={value.key}
        onValueChange={(key) => {
          if (key === "custom") {
            onChange({ key: "custom", from: value.from, to: value.to });
            setOpen(true);
          } else {
            onChange({ key: key as StatsRangeKey });
          }
        }}
      >
        <SelectTrigger className="h-9 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PRESET_KEYS.map((key) => (
            <SelectItem key={key} value={key}>
              {RANGE_LABELS[key]}
            </SelectItem>
          ))}
          <SelectItem value="custom">{RANGE_LABELS.custom}</SelectItem>
        </SelectContent>
      </Select>

      {value.key === "custom" && (
        <DateRangePicker
          from={value.from}
          to={value.to}
          open={open}
          onOpenChange={setOpen}
          onChange={(from, to) => onChange({ key: "custom", from, to })}
        />
      )}
    </div>
  );
}

/**
 * The from/to calendar behind the 自訂區間 option, on its own so the beancount export's
 * custom range picks days the same way the stats page does. Days are local "YYYY-MM-DD";
 * turn them into instants with `customRangeToQueryBounds` before sending them anywhere.
 */
export function DateRangePicker({
  from,
  to,
  open,
  onOpenChange,
  onChange,
}: {
  from?: string;
  to?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (from: string | undefined, to: string | undefined) => void;
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="h-9 w-full justify-start text-xs font-normal"
        >
          <CalendarIcon className="size-3.5" />
          {from && to ? `${from} ~ ${to}` : "選擇日期範圍"}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="range"
          selected={{
            from: from ? parseLocalDay(from) : undefined,
            to: to ? parseLocalDay(to) : undefined,
          }}
          onSelect={(range) => {
            onChange(
              range?.from ? ymd(range.from) : undefined,
              range?.to ? ymd(range.to) : undefined,
            );
            if (range?.from && range?.to) onOpenChange(false);
          }}
          numberOfMonths={1}
          initialFocus
        />
      </PopoverContent>
    </Popover>
  );
}
