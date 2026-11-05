"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Auto-loads in a row while the sentinel never leaves view, before handing back to the button. */
const MAX_CONSECUTIVE = 5;

/**
 * Infinite scroll for a paginated list: attach `sentinelRef` to an element after
 * the last row and `onLoadMore` fires as it nears the viewport.
 *
 * `loadedPages` re-arms the observer after each page lands, so a sentinel that is
 * still in view (a short page, or a client-side filter that hid most rows) keeps
 * loading. That is capped at `MAX_CONSECUTIVE` so a filter matching nothing can't
 * drain a large group in one go; the cap resets once the sentinel leaves view.
 *
 * Returns `needsButton` when auto-loading can't be relied on — no
 * `IntersectionObserver`, an error, or the cap — so the caller shows a manual
 * "load more" button instead of leaving the list stuck.
 */
export function useAutoLoadMore({
  hasMore,
  loading,
  error,
  loadedPages,
  onLoadMore,
}: {
  hasMore: boolean;
  loading: boolean;
  error: unknown;
  loadedPages: number;
  onLoadMore: () => void;
}) {
  const [node, setNode] = useState<Element | null>(null);
  const [capped, setCapped] = useState(false);
  const streak = useRef(0);
  const onLoadMoreRef = useRef(onLoadMore);
  // Before the observer effect below, so a fired callback is never stale.
  useEffect(() => {
    onLoadMoreRef.current = onLoadMore;
  });

  const supported = typeof IntersectionObserver !== "undefined";
  const active = supported && hasMore && !loading && !error;

  useEffect(() => {
    if (!active || !node) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) {
          streak.current = 0;
          setCapped(false);
          return;
        }
        // Capped: stay subscribed so leaving view can reset it, but load nothing.
        if (streak.current >= MAX_CONSECUTIVE) {
          setCapped(true);
          return;
        }
        streak.current += 1;
        onLoadMoreRef.current();
      },
      { rootMargin: "200px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [active, node, loadedPages]);

  // Callback ref, so the effect sees the node when it mounts after the first load.
  const sentinelRef = useCallback((el: Element | null) => setNode(el), []);

  // A deliberate tap re-arms auto-loading, which the cap would otherwise withhold until
  // the sentinel left view and came back.
  const loadMore = useCallback(() => {
    streak.current = 0;
    setCapped(false);
    onLoadMoreRef.current();
  }, []);

  return { sentinelRef, loadMore, needsButton: hasMore && (!supported || !!error || capped) };
}
