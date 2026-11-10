import { describe, expect, it } from "vitest";

import { formatStars } from "@/lib/github-repo";

describe("formatStars", () => {
  it("abbreviates thousands the way GitHub does, never rounding up", () => {
    expect(formatStars(0)).toBe("0");
    expect(formatStars(999)).toBe("999");
    expect(formatStars(1000)).toBe("1k");
    expect(formatStars(1234)).toBe("1.2k");
    expect(formatStars(1999)).toBe("1.9k");
    expect(formatStars(12000)).toBe("12k");
  });
});
