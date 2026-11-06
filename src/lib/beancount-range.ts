import { isDay } from "./day";

/**
 * The beancount export's range, as the page sends it and the routes read it back.
 * Both ends live here so the query string can't drift between them.
 *
 * - `new`: records created after the last 全部 / 上次匯出後 export (by `created_at`,
 *   so a record back-dated into an earlier month is still picked up).
 * - `all`: every record.
 * - `custom`: by spending date, `from`/`to` as `YYYY-MM-DD` days, inclusive. A record's
 *   date has no time and no zone, so a picked day needs no translation.
 */
export type BeancountRangeQuery =
  { kind: "new" } | { kind: "all" } | { kind: "custom"; from: string; to: string };

export function beancountRangeParams(range: BeancountRangeQuery): Record<string, string> {
  if (range.kind !== "custom") return { range: range.kind };
  return { range: "custom", from: range.from, to: range.to };
}

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

  const from = get("from");
  const to = get("to");
  if (!from || !to || !isDay(from) || !isDay(to)) {
    return { error: "custom range needs from and to as YYYY-MM-DD" };
  }
  if (from > to) return { error: "from must not be after to" };
  return { kind: "custom", from, to };
}
