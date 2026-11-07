import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { McpAuth } from "@/lib/auth/mcp";

import { MCP_INSTRUCTIONS } from "./instructions";
import { registerPrompts } from "./prompts";
import { registerEditTools } from "./tools/edit";
import { registerGroupTools } from "./tools/groups";
import { registerReceiptTools } from "./tools/receipts";
import { registerRecordTools } from "./tools/records";
import { registerWriteTools } from "./tools/write";

/** A fresh server per request (stateless transport), closed over the caller's auth. */
export function createMcpServer(auth: McpAuth): McpServer {
  const server = new McpServer(
    { name: "splitbill", version: "1.0.0" },
    { instructions: MCP_INSTRUCTIONS },
  );
  registerGroupTools(server, auth);
  registerRecordTools(server, auth);
  registerWriteTools(server, auth);
  registerEditTools(server, auth);
  registerReceiptTools(server, auth);
  registerPrompts(server);
  return server;
}
