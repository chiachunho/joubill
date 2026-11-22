import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The grouped panel (docs/design-system.md §5): `rounded-2xl bg-secondary/50`, rows
 * separated by `divide-border/40`. Rows are `flex items-center gap-3 px-4 py-3`.
 *
 * - `divided={false}` for a panel holding one block rather than rows.
 * - `muted` for a secondary block that should read quieter (暫停分帳, 誰付得最多).
 * - `as="ul"` when the rows are a list.
 */
export function Panel({
  divided = true,
  muted = false,
  as: Tag = "div",
  className,
  children,
  ...rest
}: {
  divided?: boolean;
  muted?: boolean;
  as?: "div" | "ul";
  className?: string;
  children: ReactNode;
  role?: string;
  "aria-label"?: string;
}) {
  return (
    <Tag
      className={cn(
        "overflow-hidden rounded-2xl",
        muted ? "bg-secondary/30" : "bg-secondary/50",
        divided && "divide-y divide-border/40",
        className,
      )}
      {...rest}
    >
      {children}
    </Tag>
  );
}

/**
 * A titled block of a page: `px-4`, a `.sect` label (and an optional action on its right,
 * such as 統計 or ＋ 支出), then its content, usually a `Panel`.
 */
export function Section({
  title,
  action,
  className,
  children,
}: {
  title: ReactNode;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn("px-4", className)}>
      {action ? (
        <div className="mb-2.5 flex items-center justify-between gap-3">
          <p className="sect">{title}</p>
          {action}
        </div>
      ) : (
        <p className="sect mb-2.5">{title}</p>
      )}
      {children}
    </section>
  );
}
