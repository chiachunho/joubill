/**
 * The feed's filter on where a change came from (issue #150): 全部, 手動記錄 (a person in the
 * app or the bot) and 透過應用程式 (a linked application through the MCP server). Parsed and
 * labelled here so the page, the store and the route cannot disagree on the values.
 */
export const ACTIVITY_SOURCES = ["all", "manual", "mcp"] as const;
export type ActivitySource = (typeof ACTIVITY_SOURCES)[number];

export const ACTIVITY_SOURCE_LABEL: Record<ActivitySource, string> = {
  all: "全部",
  manual: "手動記錄",
  mcp: "透過應用程式",
};

/** `null` (no parameter) is 全部; anything unknown is `undefined`, which the route answers with 400. */
export function parseActivitySource(raw: string | null): ActivitySource | undefined {
  if (raw === null) return "all";
  return (ACTIVITY_SOURCES as readonly string[]).includes(raw)
    ? (raw as ActivitySource)
    : undefined;
}
