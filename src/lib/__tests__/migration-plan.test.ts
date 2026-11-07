import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { migrationId, pendingMigrations } from "../migration-plan";

describe("pendingMigrations", () => {
  it("returns only the migrations not yet applied, in numeric order", () => {
    const files = ["0003-c.ts", "0001-a.ts", "0002-b.ts"];
    expect(pendingMigrations(files, ["0001-a"])).toEqual(["0002-b.ts", "0003-c.ts"]);
  });

  it("returns nothing when everything has run", () => {
    expect(pendingMigrations(["0001-a.ts"], ["0001-a"])).toEqual([]);
  });

  it("ignores dotfiles such as .gitkeep", () => {
    expect(pendingMigrations([".gitkeep"], [])).toEqual([]);
  });

  it("rejects a misnamed file instead of silently never running it", () => {
    expect(() => pendingMigrations(["add-column.ts"], [])).toThrow(/invalid migration file name/);
    expect(() => pendingMigrations(["001-a.ts"], [])).toThrow(/invalid/);
  });

  it("rejects two migrations that share a number", () => {
    expect(() => pendingMigrations(["0001-a.ts", "0001-b.ts"], [])).toThrow(/share the number/);
  });

  it("migrationId strips the extension", () => {
    expect(migrationId("0001-a.ts")).toBe("0001-a");
  });
});

describe("migration files", () => {
  // `sql` is a tagged template. An escape that is invalid in a template literal (`\1`, an
  // octal escape) leaves its cooked string `undefined`, and the Neon tag then sends the query
  // "undefined": the migration throws, and with it the Vercel build. A backslash that reaches
  // Postgres (a regexp_replace back-reference, say) is written `\\1`.
  const dir = path.resolve(__dirname, "../../../migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));

  it("finds the migrations", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)("%s has no escape a template literal rejects", (file) => {
    const source = readFileSync(path.join(dir, file), "utf8");
    expect(source).not.toMatch(/(?<!\\)(?:\\\\)*\\[1-9]/);
  });
});
