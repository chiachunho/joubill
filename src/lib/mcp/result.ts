import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { HttpError, TooManyRequestsError } from "@/lib/auth/errors";

/**
 * Tool results carry the data twice: as `structuredContent`, and as one JSON text block in
 * `content`, because some clients show a model only `content`. **User-controlled text
 * (descriptions, names, group titles) appears only inside that JSON**; the first text block
 * is a fixed sentence built from ids and numbers, so a hostile description is never part of
 * the prose, only a string value in data the server's `instructions` call data.
 */
export type ToolErrorCode =
  | "bad_request"
  | "forbidden"
  | "not_found"
  | "rate_limited"
  | "member_not_found"
  | "member_ambiguous"
  | "in_progress"
  | "internal";

export class ToolError extends Error {
  constructor(
    public readonly code: ToolErrorCode,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ToolError";
  }
}

export function ok(summary: string, data: Record<string, unknown>): CallToolResult {
  return {
    content: [
      { type: "text", text: summary },
      { type: "text", text: JSON.stringify(data) },
    ],
    structuredContent: data,
  };
}

export function fail(
  code: ToolErrorCode,
  message: string,
  details: Record<string, unknown> = {},
): CallToolResult {
  const data = { error: { code, message, ...details } };
  return {
    isError: true,
    content: [
      { type: "text", text: `error: ${code}` },
      { type: "text", text: JSON.stringify(data) },
    ],
    structuredContent: data,
  };
}

/** What to do next, per code: the agent reads the message and may have nothing else (issue #151). */
export const NEXT_STEP: Partial<Record<ToolErrorCode, string>> = {
  forbidden:
    "Tell the user this connection cannot do that; they can change its permission or groups under Settings > Linked applications.",
  not_found: "Check the ids with list_groups, get_group or list_records.",
  rate_limited: "Wait for retryAfterSeconds before calling again, or tell the user.",
  in_progress: "Retry shortly with the same idempotencyKey.",
};

/** Appends the next step unless the message already tells one (member errors do). */
export function withNextStep(code: ToolErrorCode, message: string): string {
  const step = NEXT_STEP[code];
  return step && !message.includes(step) ? `${message}. ${step}` : message;
}

const CODE_BY_STATUS: Record<number, ToolErrorCode> = {
  400: "bad_request",
  401: "forbidden",
  403: "forbidden",
  404: "not_found",
  429: "rate_limited",
};

/** Runs a tool body; known errors become a tool error, anything else a generic one. */
export async function guarded(run: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof ToolError) {
      return fail(err.code, withNextStep(err.code, err.message), err.details);
    }
    if (err instanceof TooManyRequestsError) {
      return fail("rate_limited", `${err.message}. ${NEXT_STEP.rate_limited}`, {
        retryAfterSeconds: err.retryAfter,
      });
    }
    if (err instanceof HttpError) {
      const code = CODE_BY_STATUS[err.status] ?? "bad_request";
      return fail(code, withNextStep(code, err.message));
    }
    console.error("[mcp] tool failed", err);
    return fail("internal", "something went wrong");
  }
}
