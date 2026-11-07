import { after } from "next/server";
import { and, eq, lt } from "drizzle-orm";

import { db } from "@/db";
import { mcpCallLog } from "@/db/schema";
import { CALL_LOG_DAYS } from "@/lib/mcp-call-log";

export type CallLogEntry = {
  connectionId: number;
  tool: string;
  groupId: number | null;
  outcome: string;
  recordId: number | null;
  durationMs: number;
};

async function write(entry: CallLogEntry): Promise<void> {
  try {
    await db.insert(mcpCallLog).values(entry);
    // Cheap with the (connection, id) index; one call in twenty is enough to keep it bounded.
    if (Math.random() < 0.05) {
      const cutoff = new Date(Date.now() - CALL_LOG_DAYS * 24 * 60 * 60 * 1000);
      await db
        .delete(mcpCallLog)
        .where(
          and(eq(mcpCallLog.connectionId, entry.connectionId), lt(mcpCallLog.createdAt, cutoff)),
        );
    }
  } catch (err) {
    // A log that fails must never fail the tool call.
    console.error("[mcp] call log failed", err);
  }
}

/** Writes after the response, so the call is not slower for it. */
export function recordMcpCall(entry: CallLogEntry): void {
  try {
    after(() => write(entry));
  } catch {
    // Outside a request scope (tests, scripts): run it now.
    void write(entry);
  }
}
