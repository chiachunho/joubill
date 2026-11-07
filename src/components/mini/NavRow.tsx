import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronRight, type LucideIcon } from "lucide-react";

/**
 * A row that hands a sub-topic to its own page: icon tile, label, chevron, no status text
 * (docs/design-system.md §6). It renders the bare row, so put it inside a panel that owns the
 * rounding and the dividers.
 */
export function NavRow({
  href,
  icon: Icon,
  children,
}: {
  href: string;
  icon: LucideIcon;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/30 active:bg-accent/50"
    >
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Icon className="size-3.5" />
      </span>
      <p className="min-w-0 flex-1 text-sm">{children}</p>
      <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/70" />
    </Link>
  );
}
