import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";

import type { McpAuth } from "@/lib/auth/mcp";
import { createMcpServer } from "@/lib/mcp/server";

import { MCP_PATH } from "@/lib/help-url";

const root = path.resolve(__dirname, "../../..");
const json = (file: string) => JSON.parse(readFileSync(path.join(root, file), "utf8"));

describe("Claude Code plugin", () => {
  const market = json(".claude-plugin/marketplace.json");
  const entry = market.plugins[0];
  const dir = path.join(root, entry.source);

  it("is listed by the marketplace under the manifest's name", () => {
    expect(market.plugins).toHaveLength(1);
    expect(existsSync(path.join(dir, ".claude-plugin/plugin.json"))).toBe(true);
    expect(json(path.join(entry.source, ".claude-plugin/plugin.json")).name).toBe(entry.name);
  });

  it("points an http server at the MCP path, with the address and token from the environment", () => {
    const server = json(path.join(entry.source, ".mcp.json")).mcpServers.joubill;
    expect(server.type).toBe("http");
    expect(server.url).toBe(`\${SPLITBILL_URL}${MCP_PATH}`);
    expect(server.headers.Authorization).toBe("Bearer ${SPLITBILL_TOKEN}");
    // A literal token or host would be committed with the repo.
    expect(JSON.stringify(server)).not.toMatch(/sbk_|https?:\/\//);
  });

  it("ships one skill with the front matter Claude Code reads", () => {
    const skill = readFileSync(path.join(dir, "skills/joubill/SKILL.md"), "utf8");
    const front = skill.match(/^---\r?\nname: (\S+)\r?\ndescription: (.+)\r?\n---\r?\n/);
    expect(front?.[1]).toBe("joubill");
    expect(front?.[2].length).toBeGreaterThan(40);
  });

  it("names only tools and prompts the server really registers", async () => {
    const skill = readFileSync(path.join(dir, "skills/joubill/SKILL.md"), "utf8");
    // Listing needs no auth: nothing runs until a tool is called.
    const server = createMcpServer({} as McpAuth);
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "1.0.0" });
    await Promise.all([server.connect(a), client.connect(b)]);
    const listed = (await client.listTools()).tools;
    const tools = listed.map((t) => t.name);
    const prompts = (await client.listPrompts()).prompts.map((p) => p.name);
    await client.close();

    // Every snake_case word in backticks is a tool, a prompt or a parameter.
    const named = [...skill.matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)].map((m) => m[1]);
    expect(named).toContain("split_receipt");
    expect(named).toContain("attach_receipt");
    expect(skill).toContain("`uploadUrl`");
    for (const name of named) expect([...tools, ...prompts]).toContain(name);
    // The skill tells the agent to preview writes with dryRun; the write tools must take it.
    expect(skill).toContain("dryRun: true");
    for (const t of listed.filter((t) => ["add_expense", "attach_receipt"].includes(t.name))) {
      expect(Object.keys(t.inputSchema.properties ?? {})).toContain("dryRun");
    }
  });
});
