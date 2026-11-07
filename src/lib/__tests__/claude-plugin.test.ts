import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

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
    const server = json(path.join(entry.source, ".mcp.json")).mcpServers.splitbill;
    expect(server.type).toBe("http");
    expect(server.url).toBe(`\${SPLITBILL_URL}${MCP_PATH}`);
    expect(server.headers.Authorization).toBe("Bearer ${SPLITBILL_TOKEN}");
    // A literal token or host would be committed with the repo.
    expect(JSON.stringify(server)).not.toMatch(/sbk_|https?:\/\//);
  });

  it("ships one skill with the front matter Claude Code reads", () => {
    const skill = readFileSync(path.join(dir, "skills/splitbill/SKILL.md"), "utf8");
    const front = skill.match(/^---\nname: (\S+)\ndescription: (.+)\n---\n/);
    expect(front?.[1]).toBe("splitbill");
    expect(front?.[2].length).toBeGreaterThan(40);
  });
});
