import type { ReactNode } from "react";

/**
 * The top of a sub-page (docs/design-system.md §3): the platform's back link, the
 * `text-lg font-semibold` title, and an optional line of `text-xs` description. `flush`
 * when the page's own wrapper already pads `px-4` (a form).
 */
export function PageHeader({
  back,
  title,
  description,
  flush = false,
}: {
  back: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  flush?: boolean;
}) {
  return (
    <div className={flush ? undefined : "px-4"}>
      {back}
      <h1 className="truncate text-lg font-semibold">{title}</h1>
      {description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}
    </div>
  );
}
