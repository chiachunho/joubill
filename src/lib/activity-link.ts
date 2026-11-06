/**
 * The link to one record's change history, and the `from` it carries so the
 * history page's 返回 goes back to where you came from.
 *
 * Built and parsed in this one file on purpose (like `deep-link.ts`): a builder
 * that drifts from its parser doesn't throw, the back link just quietly falls
 * back to the group home. Three places link here (the activity feed, and the
 * expense and settlement forms), and each used to hand-write the URL.
 */

type Scope = { appBase: string; groupId: string | number };

const groupPrefix = ({ appBase, groupId }: Scope) => `${appBase}/groups/${groupId}/`;

/** The group's own feed: where a row's history link comes from, and where 動態紀錄 lives. */
export function activityFeedHref(scope: Scope): string {
  return `${groupPrefix(scope)}activity`;
}

/** `from` is only ever a page inside this group on the same front end. */
export function recordHistoryHref(scope: Scope & { recordId: number; from?: string }): string {
  const base = `${activityFeedHref(scope)}?record=${scope.recordId}`;
  const from = scope.from && parseHistoryFrom(scope.from, scope);
  return from ? `${base}&from=${encodeURIComponent(from)}` : base;
}

/**
 * Reads `?from=` back. Anything that isn't a plain path under this group's own
 * prefix is dropped (null), so the param can't be used to bounce someone to
 * another site or another group: `//evil.test`, `https://…`, `/mini/…` when on
 * `/app`, and `..` segments all fail. Any `%` fails too: `%2e%2e` is a dot
 * segment to a browser, so it would step out of the group's prefix after the
 * check, and these paths are only ever plain ids and words.
 */
export function parseHistoryFrom(raw: string | null | undefined, scope: Scope): string | null {
  if (!raw) return null;
  const prefix = groupPrefix(scope);
  if (!raw.startsWith(prefix)) return null;
  const rest = raw.slice(prefix.length);
  if (rest === "" || rest.startsWith("/") || /[\\\s%]/.test(rest) || rest.includes("//"))
    return null;
  if (rest.split(/[/?#]/).some((seg) => seg === "." || seg === "..")) return null;
  return raw;
}
