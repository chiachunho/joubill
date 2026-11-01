/**
 * The beancount export's range, as the page sends it and the routes read it back.
 * Both ends live here so the query string can't drift between them.
 *
 * - `new`: records created after the last 全部 / 上次匯出後 export (by `created_at`,
 *   so a record back-dated into an earlier month is still picked up).
 * - `all`: every record.
 * - `custom`: by spending date, `from`/`to` as full ISO instants. The browser turns
 *   "the days I picked" into instants (`customRangeToQueryBounds`), since only it
 *   knows the viewer's day boundaries; see the stats page for the bug a bare date caused.
 */
export type BeancountRangeQuery =
  | { kind: "new" }
  | { kind: "all" }
  | { kind: "custom"; from: Date; to: Date };

export function beancountRangeParams(range: BeancountRangeQuery): Record<string, string> {
  if (range.kind !== "custom") return { range: range.kind };
  return { range: "custom", from: range.from.toISOString(), to: range.to.toISOString() };
}

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

export function parseBeancountRange(
  params: URLSearchParams | Record<string, unknown>,
): BeancountRangeQuery | { error: string } {
  const get = (key: string): string | null => {
    const v = params instanceof URLSearchParams ? params.get(key) : params[key];
    return typeof v === "string" ? v : null;
  };
  const kind = get("range");
  if (kind === "new" || kind === "all") return { kind };
  if (kind !== "custom") return { error: "range must be new, all or custom" };

  const fromStr = get("from");
  const toStr = get("to");
  if (!fromStr || !toStr || !ISO_INSTANT.test(fromStr) || !ISO_INSTANT.test(toStr)) {
    return { error: "custom range needs from and to as ISO timestamps" };
  }
  const from = new Date(fromStr);
  const to = new Date(toStr);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return { error: "invalid from/to" };
  }
  if (from > to) return { error: "from must not be after to" };
  return { kind: "custom", from, to };
}
