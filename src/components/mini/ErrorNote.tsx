import type { ReactNode, Ref } from "react";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * An error or a warning the person should read before going on (docs/design-system.md §1:
 * `bg-destructive/10 text-destructive`): a save that failed, or what a destructive step
 * cannot undo. With `onDismiss` it gets a ✕ to close it. Not for the 無法載入 page state
 * (`LoadError`) or a one-line hint under a field.
 */
export function ErrorNote({
  children,
  onDismiss,
  className,
  ref,
}: {
  children: ReactNode;
  onDismiss?: () => void;
  className?: string;
  ref?: Ref<HTMLDivElement>;
}) {
  return (
    <div
      ref={ref}
      role="alert"
      className={cn(
        "flex items-start gap-2 rounded-lg bg-destructive/10 px-4 py-2.5 text-sm text-destructive",
        className,
      )}
    >
      <div className="min-w-0 flex-1">{children}</div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="關閉"
          className="-my-0.5 -mr-1.5 shrink-0 rounded-lg p-1 transition-colors hover:bg-destructive/10"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}
