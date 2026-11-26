/**
 * How long a cached read counts as fresh when it is about data that rarely changes and whose
 * own changes already invalidate it (see `withSlowRefetch`). The app-wide default in `api.ts`
 * is 5 s, which makes every page change re-ask for it.
 */
export const SLOW_REFETCH_SECONDS = 600;

type QueryHook = (arg: never, options?: never) => unknown;

/**
 * Wraps a query hook so that coming back to a page within `SLOW_REFETCH_SECONDS` shows the cache
 * without asking the server again. A caller's own `refetchOnMountOrArgChange` still wins.
 *
 * RTK Query takes this option only on `createApi` and on the hook, not on one endpoint, hence a
 * wrapper. **Use it only for data that something in this app invalidates when it changes** (an
 * edit made here), and where a stale copy for a few minutes does no harm; a members list or the
 * group's settings are not that: a stale one could leave a new member out of a split.
 */
export function withSlowRefetch<H extends QueryHook>(hook: H): H {
  const wrapped = (arg: unknown, options?: Record<string, unknown>) =>
    (hook as unknown as (a: unknown, o: Record<string, unknown>) => unknown)(arg, {
      refetchOnMountOrArgChange: SLOW_REFETCH_SECONDS,
      ...options,
    });
  return wrapped as unknown as H;
}
