import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * A select that takes a person's provider name but not `display_name` still compiles when its
 * rows go straight into a JSON response, and just shows the old name somewhere (issue #101).
 * The compiler catches the rows that reach `labelUser`; this catches the rest: any file that
 * selects `users.firstName` must also select `users.displayName`. (`USER_COLUMNS` in
 * `src/bot/profiles.ts` has both.)
 */
const ALLOWED = new Set([
  // Writes the provider name; never renders it.
  "src/lib/auth/upsertTelegramUser.ts",
  // Placeholders have no display name, only first_name.
  "src/app/api/invites/[code]/route.ts",
]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "__tests__" ? [] : walk(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("display name coverage", () => {
  it("every query that selects a provider name also selects display_name", () => {
    const missing = walk("src").filter((file) => {
      if (ALLOWED.has(file)) return false;
      const text = readFileSync(file, "utf8");
      return text.includes("users.firstName") && !text.includes("users.displayName");
    });
    expect(missing).toEqual([]);
  });
});
