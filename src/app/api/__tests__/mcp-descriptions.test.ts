import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What an agent is told (issue #151): the server instructions and every tool's description
 * and schema, read through the real SDK transport without a database.
 */

vi.mock("@/db", () => ({
  db: new Proxy({}, { get: () => Promise.reject(new Error("database touched")) }),
}));
vi.mock("@/lib/rate-limit", () => ({ enforceMcpRateLimit: vi.fn() }));
vi.mock("@/lib/auth/mcp", () => ({
  getMcpAuth: vi.fn(async () => ({
    user: { id: 1 },
    grant: { connectionId: 1, access: "write", allGroups: true, groupIds: [] },
  })),
}));

import { POST } from "@/app/api/mcp/route";
import { SUPPORTED_CURRENCIES } from "@/lib/zod";

type Tool = {
  name: string;
  description?: string;
  inputSchema: { properties?: Record<string, { enum?: string[] }> };
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean };
};

const rpc = (body: unknown) =>
  POST(
    new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: "Bearer sbk_x",
      },
      body: JSON.stringify(body),
    }),
  );

let tools: Tool[];
let instructions: string;

beforeEach(async () => {
  if (tools) return;
  const list = (await (await rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" })).json()) as {
    result: { tools: Tool[] };
  };
  tools = list.result.tools;
  const init = (await (
    await rpc({
      jsonrpc: "2.0",
      id: 2,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "test", version: "1" },
      },
    })
  ).json()) as { result: { instructions?: string } };
  instructions = init.result.instructions ?? "";
});

describe("MCP server instructions", () => {
  it("tell an agent the working method", () => {
    expect(instructions).toContain("list_groups");
    expect(instructions).toContain("get_group");
    expect(instructions).toContain("dryRun");
    expect(instructions).toMatch(/never guess/i);
    expect(instructions).toMatch(/time zone/i);
    expect(instructions).toContain("idempotencyKey");
  });
});

describe("MCP tools", () => {
  it("every tool has a description that says more than its name", () => {
    expect(tools.length).toBeGreaterThan(0);
    for (const t of tools) {
      expect(t.description?.length ?? 0, t.name).toBeGreaterThan(60);
    }
  });

  it("marks every tool as read-only or as a write", () => {
    for (const t of tools) {
      expect(typeof t.annotations?.readOnlyHint, t.name).toBe("boolean");
    }
  });

  it("restricts currency arguments to the supported currencies", () => {
    const withCurrency = tools.filter((t) => t.inputSchema.properties?.currency?.enum);
    expect(withCurrency.map((t) => t.name)).toContain("add_expense");
    for (const t of withCurrency) {
      expect(t.inputSchema.properties?.currency?.enum, t.name).toEqual([...SUPPORTED_CURRENCIES]);
    }
  });

  it("every write tool can be previewed with dryRun", () => {
    for (const t of tools.filter((x) => x.annotations?.readOnlyHint === false)) {
      expect(t.inputSchema.properties, t.name).toHaveProperty("dryRun");
    }
  });
});
