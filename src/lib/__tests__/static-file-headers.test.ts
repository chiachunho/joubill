import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

type HeaderRule = { source: string; headers: { key: string; value: string }[] };

const publicDir = fileURLToPath(new URL("../../../public", import.meta.url));
// A path held in a variable: the config is untyped JavaScript, so a literal import would not compile.
const configPath = fileURLToPath(new URL("../../../next.config.mjs", import.meta.url));
// Next's own matcher, the one `headers()` sources are compiled with (it ships no types).
const matcherModule = "next/dist/compiled/path-to-regexp";
const loadMatcher = async () =>
  (await import(/* @vite-ignore */ matcherModule)) as { pathToRegexp(source: string): RegExp };
const loadConfig = async () =>
  (await import(/* @vite-ignore */ configPath)).default as { headers(): Promise<HeaderRule[]> };

/** The Cache-Control value a request path ends up with, last matching rule winning. */
async function cacheControlFor(path: string): Promise<string | undefined> {
  const rules = await (await loadConfig()).headers();
  const { pathToRegexp } = await loadMatcher();
  let value: string | undefined;
  for (const rule of rules) {
    if (!pathToRegexp(rule.source).test(path)) continue;
    value = rule.headers.find((h) => h.key === "Cache-Control")?.value ?? value;
  }
  return value;
}

describe("Cache-Control of the files in public/", () => {
  // Vercel serves public/ with `max-age=0, must-revalidate`, which makes every page load ask for
  // every icon again. A new file there gets a decision: add it to next.config.mjs, or here.
  const revalidated = new Set(["sw.js"]);

  for (const file of readdirSync(publicDir)) {
    if (revalidated.has(file)) continue;
    it(`/${file} may be cached for a day`, async () => {
      expect(await cacheControlFor(`/${file}`)).toMatch(/max-age=86400/);
    });
  }

  it("keeps the service worker revalidated on every visit", async () => {
    expect(await cacheControlFor("/sw.js")).toMatch(/no-store/);
  });
});
