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
