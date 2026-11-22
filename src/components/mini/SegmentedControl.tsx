"use client";

import type { ComponentType, ReactNode } from "react";
import { cn } from "@/lib/utils";

export type SegmentOption<T extends string> = {
  value: T;
  label: ReactNode;
  icon?: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
};

/**
 * A pick-one toggle (docs/design-system.md §6): a `rounded-lg` track with `rounded-md`
 * segments. Two sizes only:
 *
 * - `sm`: a compact view switch beside a section label (總額／淨額, 最近更新／名稱),
 *   as wide as its labels; the chosen segment is lifted onto the page background, since
 *   it only changes how the page reads.
 * - `md`: a form field or a filter across the width of the page, equal segments, bordered
 *   like an input; the chosen segment is `primary`, the design system's selected state
 *   (the expense form's 分帳方式 set this look, and the refund form follows it).
 *
 * Every toggle in the app is this component, so they can't drift in height, colour or
 * weight again.
 */
export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
  size = "md",
  className,
}: {
  /** Names the group for assistive technology; it is not shown. */
  label: string;
  value: T;
  options: readonly SegmentOption<T>[];
  onChange: (value: T) => void;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        "gap-0.5 rounded-lg p-0.5",
        size === "sm"
          ? "inline-flex bg-secondary"
          : "grid w-full auto-cols-fr grid-flow-col border border-input bg-secondary/40",
        className,
      )}
    >
      {options.map((o) => {
        const selected = o.value === value;
        const Icon = o.icon;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(o.value)}
            className={cn(
              "flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors",
              size === "sm" ? "px-3 py-1 text-xs" : "px-2 py-1.5 text-sm",
              selected
                ? size === "sm"
                  ? "bg-background text-foreground shadow-sm"
                  : "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {Icon && <Icon className={size === "sm" ? "size-3.5" : "size-4"} aria-hidden />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
