/**
 * The 使用紀錄 vocabulary (issue #153), pure so it is unit-tested: which tools write, how a tool
 * result becomes one of a fixed set of outcomes, the filters, the cursor and the labels. What is
 * logged is only ever this: a tool name, a group id, an outcome, a record id and a duration.
 */

export const CALL_LOG_DAYS = 30;
export const CALLS_PAGE_SIZE = 30;

export const WRITE_TOOLS = [
  "add_expense",
  "add_settlement",
  "update_record",
  "delete_record",
  "attach_receipt",
] as const;

/** Outcomes that are not failures. Everything else is a `ToolErrorCode`. */
export const SUCCESS_OUTCOMES = ["ok", "preview", "duplicate", "possible_duplicate"] as const;

export const CALL_FILTERS = ["all", "write", "failed"] as const;
export type CallFilter = (typeof CALL_FILTERS)[number];
export const CALL_FILTER_LABEL: Record<CallFilter, string> = {
  all: "全部",
  write: "寫入",
  failed: "失敗",
};

export function parseCallFilter(raw: string | null): CallFilter | null {
  return (CALL_FILTERS as readonly string[]).includes(raw ?? "") ? (raw as CallFilter) : null;
}

type ResultLike = { isError?: boolean; structuredContent?: Record<string, unknown> };

/** The fixed outcome of a tool result: an error's code, a preview / duplicate status, else `ok`. */
export function callOutcome(result: ResultLike): string {
  const data = result.structuredContent;
  if (result.isError) {
    const err = data?.error as { code?: unknown } | undefined;
    return typeof err?.code === "string" ? err.code.slice(0, 24) : "internal";
  }
  const status = data?.status;
  return status === "preview" || status === "duplicate" || status === "possible_duplicate"
    ? status
    : "ok";
}

const intOrNull = (v: unknown): number | null =>
  typeof v === "number" && Number.isInteger(v) && v > 0 && v <= 2_147_483_647 ? v : null;

/** The record a call concerned: the one it created or touched, else the one it was asked about. */
export function callRecordId(args: unknown, result: ResultLike): number | null {
  const fromResult = intOrNull(result.structuredContent?.recordId);
  if (fromResult) return fromResult;
  return intOrNull((args as { recordId?: unknown } | null)?.recordId);
}

export function callGroupId(args: unknown): number | null {
  return intOrNull((args as { groupId?: unknown } | null)?.groupId);
}

export type OutcomeTone = "ok" | "info" | "bad";

const OUTCOME: Record<string, { label: string; tone: OutcomeTone }> = {
  ok: { label: "成功", tone: "ok" },
  preview: { label: "預覽", tone: "info" },
  duplicate: { label: "重複", tone: "info" },
  possible_duplicate: { label: "疑似重複", tone: "info" },
  bad_request: { label: "參數有誤", tone: "bad" },
  forbidden: { label: "沒有權限", tone: "bad" },
  not_found: { label: "找不到", tone: "bad" },
  rate_limited: { label: "太頻繁", tone: "bad" },
  member_not_found: { label: "找不到成員", tone: "bad" },
  member_ambiguous: { label: "成員不明確", tone: "bad" },
  in_progress: { label: "處理中", tone: "bad" },
  conflict: { label: "版本衝突", tone: "bad" },
  internal: { label: "系統錯誤", tone: "bad" },
};

export function outcomeInfo(outcome: string): { label: string; tone: OutcomeTone } {
  return OUTCOME[outcome] ?? { label: "失敗", tone: "bad" };
}

export const isWriteTool = (tool: string) => (WRITE_TOOLS as readonly string[]).includes(tool);

/** A call that changed (or could have changed) a record and succeeded: its record link is real. */
export const linksToRecord = (tool: string, outcome: string) =>
  isWriteTool(tool) && (outcome === "ok" || outcome === "duplicate");

/** The cursor is the last row's id; anything but plain int4 digits is a 400, not a Postgres error. */
export function parseCallCursor(raw: string): number | null {
  if (!/^\d{1,10}$/.test(raw)) return null;
  const n = Number(raw);
  return n > 0 && n <= 2_147_483_647 ? n : null;
}

export function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms} 毫秒` : `${(ms / 1000).toFixed(1)} 秒`;
}
