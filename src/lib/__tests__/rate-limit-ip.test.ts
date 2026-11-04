import { describe, expect, it } from "vitest";

import { ipKey } from "@/lib/rate-limit";

describe("ipKey", () => {
  it("is stable per address and never contains the address", () => {
    const a = ipKey(new Headers({ "x-real-ip": "203.0.113.5" }));
    expect(a).toBe(ipKey(new Headers({ "x-vercel-forwarded-for": "203.0.113.5" })));
    expect(a).not.toContain("203");
    expect(a).not.toBe(ipKey(new Headers({ "x-real-ip": "203.0.113.6" })));
  });

  it("is null when no address is known", () => {
    expect(ipKey(new Headers())).toBeNull();
  });
});
