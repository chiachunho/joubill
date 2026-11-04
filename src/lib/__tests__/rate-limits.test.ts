import { describe, expect, it } from "vitest";

import {
  clientIp,
  decide,
  RATE_RULES,
  rateKey,
  type RateRule,
  sweepBefore,
  windowStart,
} from "@/lib/rate-limits";

const TEN_MIN = 10 * 60_000;
const rule = (limit: number, windowMs = TEN_MIN): RateRule => ({ name: "t", limit, windowMs });

describe("windowStart", () => {
  it("floors to the window, so every instant inside shares one row", () => {
    const start = new Date("2026-11-04T10:00:00.000Z");
    expect(windowStart(new Date("2026-11-04T10:00:00.000Z"), TEN_MIN)).toEqual(start);
    expect(windowStart(new Date("2026-11-04T10:09:59.999Z"), TEN_MIN)).toEqual(start);
    expect(windowStart(new Date("2026-11-04T10:10:00.000Z"), TEN_MIN)).toEqual(
      new Date("2026-11-04T10:10:00.000Z"),
    );
  });
});

describe("decide", () => {
  it("allows up to the limit and refuses the one after", () => {
    expect(decide([{ rule: rule(3), count: 3 }])).toEqual({ ok: true });
    expect(decide([{ rule: rule(3), count: 4 }])).toEqual({
      ok: false,
      retryAfter: 600,
      firstRefusal: true,
    });
  });

  it("marks only the first refused attempt in a window", () => {
    const later = decide([{ rule: rule(3), count: 5 }]);
    expect(later).toMatchObject({ ok: false, firstRefusal: false });
  });

  it("refuses when any one rule is over, even if the others are fine", () => {
    expect(
      decide([
        { rule: rule(30), count: 1 },
        { rule: rule(2), count: 3 },
      ]),
    ).toMatchObject({ ok: false });
  });

  it("gives the full window as retryAfter, never the time left in it", () => {
    // Same answer at any point in the window, so the header can't reveal the boundary.
    const a = decide([{ rule: rule(1), count: 2 }]);
    expect(a).toMatchObject({ retryAfter: 600 });
    const both = decide([
      { rule: rule(1, 60_000), count: 2 },
      { rule: rule(1, TEN_MIN), count: 9 },
    ]);
    expect(both).toMatchObject({ retryAfter: 600, firstRefusal: true });
  });

  it("answers 600 for every configured rule", () => {
    for (const r of Object.values(RATE_RULES)) {
      expect(decide([{ rule: r, count: r.limit + 1 }])).toMatchObject({ retryAfter: 600 });
    }
  });
});

describe("rateKey", () => {
  it("keeps rules apart for the same id", () => {
    expect(rateKey(RATE_RULES.inviteUser, 7)).toBe("invite:user:7");
    expect(rateKey(RATE_RULES.linkSender, 7)).not.toBe(rateKey(RATE_RULES.inviteUser, 7));
  });
});

describe("sweepBefore", () => {
  it("keeps a day, well past every window", () => {
    const now = new Date("2026-11-04T10:00:00Z");
    expect(sweepBefore(now)).toEqual(new Date("2026-11-03T10:00:00Z"));
    const longest = Math.max(...Object.values(RATE_RULES).map((r) => r.windowMs));
    expect(now.getTime() - sweepBefore(now).getTime()).toBeGreaterThan(longest);
  });
});

describe("clientIp", () => {
  it("prefers Vercel's own header and takes the first hop", () => {
    const h = new Headers({
      "x-vercel-forwarded-for": "203.0.113.5, 10.0.0.1",
      "x-forwarded-for": "198.51.100.9",
    });
    expect(clientIp(h)).toBe("203.0.113.5");
  });

  it("falls back to x-real-ip, then x-forwarded-for", () => {
    expect(clientIp(new Headers({ "x-real-ip": "198.51.100.1" }))).toBe("198.51.100.1");
    expect(clientIp(new Headers({ "x-forwarded-for": " 198.51.100.2 ,x" }))).toBe("198.51.100.2");
  });

  it("is null without any of them, so the IP rule is skipped", () => {
    expect(clientIp(new Headers())).toBeNull();
    expect(clientIp(new Headers({ "x-forwarded-for": "" }))).toBeNull();
  });
});
