import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import type { McpAuth } from "@/lib/auth/mcp";
import { callGroupId, callOutcome, callRecordId } from "@/lib/mcp-call-log";
import { recordMcpCall } from "@/lib/mcp-call-log-db";

import { MCP_INSTRUCTIONS } from "./instructions";
import { registerPrompts } from "./prompts";
import { registerEditTools } from "./tools/edit";
import { registerGroupTools } from "./tools/groups";
import { registerReceiptTools } from "./tools/receipts";
import { registerRecordTools } from "./tools/records";
import { registerWriteTools } from "./tools/write";

/**
 * Wraps every tool the server registers so each call leaves one `mcp_call_log` row (issue #153).
 * Done here, once, rather than in each tool: a tool added later is logged without anyone
 * remembering to. Only ids and a fixed outcome are recorded, never the arguments.
 */
function logCalls(server: McpServer, auth: McpAuth): void {
  const register = server.registerTool.bind(server) as (...a: unknown[]) => unknown;
  (server as { registerTool: unknown }).registerTool = (
    name: string,
    config: unknown,
    cb: (...a: unknown[]) => Promise<CallToolResult> | CallToolResult,
  ) =>
    register(name, config, async (...a: unknown[]) => {
      const started = Date.now();
      const result = await cb(...a);
      recordMcpCall({
        connectionId: auth.grant.connectionId,
        tool: name.slice(0, 32),
        groupId: callGroupId(a[0]),
        outcome: callOutcome(result),
        recordId: callRecordId(a[0], result),
        durationMs: Math.min(Date.now() - started, 2_147_483_647),
      });
      return result;
    });
}

/** A fresh server per request (stateless transport), closed over the caller's auth. */
export function createMcpServer(auth: McpAuth): McpServer {
  const server = new McpServer(
    { name: "joubill", version: "1.0.0" },
    { instructions: MCP_INSTRUCTIONS },
  );
  logCalls(server, auth);
  registerGroupTools(server, auth);
  registerRecordTools(server, auth);
  registerWriteTools(server, auth);
  registerEditTools(server, auth);
  registerReceiptTools(server, auth);
  registerPrompts(server);
  return server;
}
