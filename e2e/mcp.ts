import type { Pool } from "@neondatabase/serverless";
import type { APIRequestContext } from "@playwright/test";

import { generateToken, hashToken, tokenDisplayPrefix } from "../src/lib/mcp-token";
import { expect } from "./fixtures";

/**
 * Helpers for specs that talk to `/api/mcp`: a connection inserted with a known token, and
 * plain JSON-RPC over HTTP with no cookie, so only the bearer token is authenticating.
 */
export async function mkToken(
  dbPool: Pool,
  userId: number,
  opts: { name?: string; access?: "read" | "write"; groupIds?: number[]; allGroups?: boolean } = {},
) {
  const token = generateToken();
  const { rows } = await dbPool.query(
    `INSERT INTO app_connections (user_id, kind, name, token_hash, token_prefix, access, all_groups, group_ids)
     VALUES ($1,'token',$7,$2,$3,$4,$5,$6) RETURNING id`,
    [
      userId,
      hashToken(token),
      tokenDisplayPrefix(token),
      opts.access ?? "write",
      opts.allGroups ?? false,
      opts.groupIds ?? [],
      opts.name ?? "E2E token",
    ],
  );
  return { token, id: rows[0].id as number };
}

let rpcId = 0;
export async function rpc(
  request: APIRequestContext,
  token: string,
  method: string,
  params?: object,
) {
  return request.post("/api/mcp", {
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
    },
    data: { jsonrpc: "2.0", id: ++rpcId, method, params },
  });
}

export type ToolResult = {
  isError?: boolean;
  structuredContent?: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
};
export async function call(request: APIRequestContext, token: string, name: string, args: object) {
  const res = await rpc(request, token, "tools/call", { name, arguments: args });
  expect(res.status()).toBe(200);
  return ((await res.json()) as { result: ToolResult }).result;
}
