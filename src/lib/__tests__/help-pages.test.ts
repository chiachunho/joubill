import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import sitemap from "@/app/sitemap";
import { HELP_PAGES, helpPage } from "@/lib/help-pages";
import { helpMetadata, jsonLdString } from "@/lib/seo";

const HELP_DIR = join(process.cwd(), "src/app/help");
const pageDirs = readdirSync(HELP_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

describe("help pages", () => {
  it("lists exactly the pages that exist on disk", () => {
    expect(HELP_PAGES.map((p) => p.slug).sort()).toEqual([...pageDirs].sort());
  });

  it("gives every page its own title and description", () => {
    expect(new Set(HELP_PAGES.map((p) => p.label)).size).toBe(HELP_PAGES.length);
    for (const p of HELP_PAGES) expect(p.description.length).toBeGreaterThan(20);
  });

  it("exports its metadata from each page.mdx", () => {
    for (const slug of pageDirs) {
      const src = readFileSync(join(HELP_DIR, slug, "page.mdx"), "utf8");
      expect(src, slug).toContain(`helpMetadata("${slug}")`);
    }
  });

  it("builds a canonical path and social card for a page", () => {
    const meta = helpMetadata("balances");
    expect(meta.title).toBe(helpPage("balances").label);
    expect(meta.alternates?.canonical).toBe("/help/balances");
  });

  it("puts the landing page and every help page in the sitemap", () => {
    const urls = sitemap().map((e) => e.url);
    expect(urls).toHaveLength(HELP_PAGES.length + 1);
    expect(urls.some((u) => u.endsWith("/help/getting-started"))).toBe(true);
  });
});

describe("jsonLdString", () => {
  it("cannot be ended early by a closing script tag", () => {
    expect(jsonLdString({ a: "</script><b>" })).not.toContain("<");
  });
});
