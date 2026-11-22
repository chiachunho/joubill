import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** The pill colours there are (docs/design-system.md §3): all through the theme variables. */
export type PillTone = "primary" | "muted" | "destructive";

const TONE: Record<PillTone, string> = {
  primary: "bg-primary/10 text-primary",
  muted: "bg-secondary text-muted-foreground",
  destructive: "bg-destructive/10 text-destructive",
};

/**
 * A small status label beside a name or a title (唯讀, 已到期, 目前登入, 無帳號 …).
 * Its text is `text-2xs`, the one size below `text-xs`; don't restyle a pill with a
 * size of its own.
 */
export function Pill({
  tone = "muted",
  strong = false,
  className,
  children,
}: {
  tone?: PillTone;
  /** Semibold, for a label that is the row's main state rather than a side note. */
  strong?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-2xs",
        strong && "font-semibold",
        TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
