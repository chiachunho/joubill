import type { ComponentType, ReactNode } from "react";

/**
 * Nothing to show yet (docs/design-system.md §7): a `size-14 rounded-2xl bg-secondary` icon
 * tile, an optional title, and a line saying why or what to do next.
 */
export function EmptyState({
  icon: Icon,
  title,
  children,
}: {
  icon: ComponentType<{ className?: string }>;
  title?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
      <span className="flex size-14 items-center justify-center rounded-2xl bg-secondary text-muted-foreground">
        <Icon className="size-6" />
      </span>
      <div className="space-y-1 max-w-xs">
        {title && <p className="font-semibold">{title}</p>}
        {children && <p className="text-sm text-muted-foreground">{children}</p>}
      </div>
    </div>
  );
}
