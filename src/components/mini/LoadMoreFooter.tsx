import type { Ref } from "react";

/**
 * The end-of-list footer for a `useAutoLoadMore` list: the sentinel the observer
 * watches, and the manual button for when auto-loading can't be relied on.
 */
export function LoadMoreFooter({
  sentinelRef,
  needsButton,
  loading,
  onClick,
  className,
}: {
  sentinelRef: Ref<HTMLDivElement>;
  needsButton: boolean;
  loading: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <div ref={sentinelRef} className={className}>
      {needsButton ? (
        <button
          type="button"
          onClick={onClick}
          disabled={loading}
          className="w-full rounded-lg bg-secondary px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-secondary/70 disabled:opacity-60"
        >
          {loading ? "載入中…" : "載入更多"}
        </button>
      ) : (
        <p aria-live="polite" className="py-2 text-center text-xs text-muted-foreground">
          {loading ? "載入中…" : " "}
        </p>
      )}
    </div>
  );
}
