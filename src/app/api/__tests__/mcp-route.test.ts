import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `/api/mcp` without a database: a call without a valid token is refused before anything
 * is read, and a signed-in `tools/list` is answered by the real SDK transport. The tool
 * bodies are database work and are covered in e2e/mcp.spec.ts.
 */

const state = vi.hoisted(() => ({ dbTouched: false }));

vi.mock("@/db", () => ({
  db: new Proxy(
    {},
    {
      get() {
        state.dbTouched = true;
        throw new Error("database touched");
      },
    },
  ),
}));

vi.mock("@/lib/rate-limit", () => ({ enforceMcpRateLimit: vi.fn() }));

import { UnauthorizedError } from "@/lib/auth/errors";

const mcpAuth = vi.hoisted(() => ({ authed: false }));
vi.mock("@/lib/auth/mcp", () => ({
  getMcpAuth: vi.fn(async () => {
    if (!mcpAuth.authed) throw new UnauthorizedError("invalid, revoked or expired token");
    return {
      user: { id: 1 },
      grant: { connectionId: 1, access: "write", allGroups: true, groupIds: [] },
    };
  }),
}));

import { DELETE, GET, POST } from "@/app/api/mcp/route";

const rpc = (body: unknown) =>
  new Request("http://localhost/api/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: "Bearer sbk_x",
    },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  state.dbTouched = false;
  mcpAuth.authed = false;
});

describe("/api/mcp", () => {
  it("answers 401 with a challenge when the token is no good, before reading anything", async () => {
    const res = await POST(rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }));
    expect(res.status).toBe(401);
    const challenge = res.headers.get("www-authenticate") ?? "";
    expect(challenge).toMatch(
      /^Bearer resource_metadata="https?:\/\/[^"]+\/\.well-known\/oauth-protected-resource"/,
    );
    expect(challenge).toContain('error="invalid_token"');
    expect(state.dbTouched).toBe(false);
  });

  it("sends a client without any token to the OAuth metadata, without an error code", async () => {
    const res = await POST(
      new Request("http://localhost/api/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: "{}",
      }),
    );
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).not.toContain("error=");
  });

  it("is POST only", async () => {
    expect(GET().status).toBe(405);
    expect(DELETE().status).toBe(405);
  });

  it("lists the core tools, with write tools marked as such", async () => {
    mcpAuth.authed = true;
    const res = await POST(rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }));
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      result: {
        tools: {
          name: string;
          annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean };
        }[];
      };
    };
    const tools = new Map(json.result.tools.map((t) => [t.name, t]));
    expect([...tools.keys()].sort()).toEqual(
      [
        "add_expense",
        "add_settlement",
        "attach_receipt",
        "get_balance",
        "get_group",
        "get_record",
        "list_groups",
        "delete_record",
        "list_records",
        "update_record",
      ].sort(),
    );
    expect(tools.get("list_groups")?.annotations?.readOnlyHint).toBe(true);
    expect(tools.get("add_expense")?.annotations?.readOnlyHint).toBe(false);
    expect(tools.get("delete_record")?.annotations?.destructiveHint).toBe(true);
    expect(tools.get("update_record")?.annotations?.destructiveHint).toBe(false);
    expect(tools.get("attach_receipt")?.annotations?.readOnlyHint).toBe(false);
    expect(tools.get("attach_receipt")?.annotations?.destructiveHint).toBe(false);
    expect(state.dbTouched).toBe(false);
  });

  it("offers the split_receipt prompt", async () => {
    mcpAuth.authed = true;
    const res = await POST(rpc({ jsonrpc: "2.0", id: 1, method: "prompts/list" }));
    const json = (await res.json()) as { result: { prompts: { name: string }[] } };
    expect(json.result.prompts.map((p) => p.name)).toEqual(["split_receipt"]);
  });
});
