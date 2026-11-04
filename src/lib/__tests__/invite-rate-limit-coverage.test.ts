import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The invite rate limit is a call each entry point makes (issue #121), so one that forgets it
 * compiles, passes its tests, and is an unthrottled way to guess codes. This catches that:
 * every file that resolves a code with `findActiveInvite` must count the attempt first,
 * through `enforceInviteRateLimit` (routes) or `consumeRateLimit` (the bot).
 */
const LIMITERS = ["enforceInviteRateLimit(", "consumeRateLimit("];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "__tests__" ? [] : walk(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("invite rate limit coverage", () => {
  it("every code lookup is preceded by a rate-limit check", () => {
    const callers = walk("src").filter(
      (file) =>
        file !== join("src", "lib", "invites.ts") &&
        /findActiveInvite\(/.test(readFileSync(file, "utf8")),
    );
    expect(callers.length).toBeGreaterThan(0);

    const unguarded = callers.filter((file) => {
      const text = readFileSync(file, "utf8");
      const lookup = text.indexOf("findActiveInvite(");
      const guard = Math.min(
        ...LIMITERS.map((l) => text.indexOf(l)).filter((i) => i >= 0),
        Infinity,
      );
      return !(guard < lookup);
    });
    expect(unguarded).toEqual([]);
  });
});
