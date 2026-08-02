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

export type StatsRangeValue = {
  key: StatsRangeKey;
  /** "YYYY-MM-DD", only meaningful (and only both set once picked) when key === "custom". */
  from?: string;
  to?: string;
};

const PRESET_LABELS: Record<Exclude<StatsRangeKey, "custom">, string> = {
  "3m": "3 個月",
  "6m": "6 個月",
  "1y": "1 年",
  all: "全部",
};

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
          {(Object.keys(PRESET_LABELS) as Array<keyof typeof PRESET_LABELS>).map((key) => (
            <SelectItem key={key} value={key}>
              {PRESET_LABELS[key]}
            </SelectItem>
          ))}
          <SelectItem value="custom">自訂區間</SelectItem>
        </SelectContent>
      </Select>

      {value.key === "custom" && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              className="h-9 w-full justify-start text-xs font-normal"
            >
              <CalendarIcon className="size-3.5" />
              {value.from && value.to ? `${value.from} ~ ${value.to}` : "選擇日期範圍"}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="range"
              selected={{
                from: value.from ? new Date(value.from) : undefined,
                to: value.to ? new Date(value.to) : undefined,
              }}
              onSelect={(range) => {
                onChange({
                  key: "custom",
                  from: range?.from ? ymd(range.from) : undefined,
                  to: range?.to ? ymd(range.to) : undefined,
                });
                if (range?.from && range?.to) setOpen(false);
              }}
              numberOfMonths={1}
              initialFocus
            />
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
