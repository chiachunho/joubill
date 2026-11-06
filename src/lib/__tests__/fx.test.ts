import { describe, expect, it } from "vitest";

import {
  buildOverrideMap,
  cacheableRateDay,
  fxDateKey,
  getRate,
  overrideKey,
  parseFxResponse,
  pinnedRate,
  spentAtForNow,
} from "../fx";

describe("parseFxResponse", () => {
  const payload = {
    date: "2026-05-27",
    usd: { twd: 31.42538559, jpy: 159.21, eur: 0.859 },
  };

  it("extracts the quote rate (case-insensitive)", () => {
    expect(parseFxResponse(payload, "USD", "TWD")).toBeCloseTo(31.4253, 3);
    expect(parseFxResponse(payload, "usd", "jpy")).toBeCloseTo(159.21, 2);
  });

  it("throws when the base block is missing", () => {
    expect(() => parseFxResponse(payload, "EUR", "USD")).toThrow(/missing rates/);
  });

  it("throws when the quote currency is absent", () => {
    expect(() => parseFxResponse(payload, "USD", "KRW")).toThrow(/not found/);
  });

  it("throws on a null / malformed payload", () => {
    expect(() => parseFxResponse(null, "USD", "TWD")).toThrow();
    expect(() => parseFxResponse({ date: "x" }, "USD", "TWD")).toThrow();
  });
});

describe("getRate", () => {
  it("short-circuits to 1 when base === quote (no db / network)", async () => {
    await expect(getRate("TWD", "TWD", new Date())).resolves.toBe(1);
    // case-insensitive
    await expect(getRate("usd", "USD", new Date())).resolves.toBe(1);
  });

  it("returns the group override without touching db / network", async () => {
    const overrides = buildOverrideMap([{ base: "JPY", quote: "TWD", rate: "0.22" }]);
    await expect(getRate("JPY", "TWD", new Date(), overrides)).resolves.toBe(0.22);
    // derived inverse pair
    await expect(getRate("TWD", "JPY", new Date(), overrides)).resolves.toBeCloseTo(1 / 0.22, 10);
  });

  it("base === quote wins even when a (nonsense) override exists", async () => {
    const overrides = new Map([[overrideKey("TWD", "TWD"), 2]]);
    await expect(getRate("TWD", "TWD", new Date(), overrides)).resolves.toBe(1);
  });
});

describe("buildOverrideMap", () => {
  it("maps explicit pairs and derives inverses", () => {
    const map = buildOverrideMap([{ base: "JPY", quote: "TWD", rate: "0.25" }]);
    expect(map.get(overrideKey("JPY", "TWD"))).toBe(0.25);
    expect(map.get(overrideKey("TWD", "JPY"))).toBeCloseTo(4, 10);
  });

  it("lets an explicit pair win over a derived inverse", () => {
    const map = buildOverrideMap([
      { base: "JPY", quote: "TWD", rate: "0.25" },
      { base: "TWD", quote: "JPY", rate: "5" }, // explicit, not 1/0.25
    ]);
    expect(map.get(overrideKey("TWD", "JPY"))).toBe(5);
    expect(map.get(overrideKey("JPY", "TWD"))).toBe(0.25);
  });

  it("ignores non-positive rates", () => {
    const map = buildOverrideMap([{ base: "JPY", quote: "TWD", rate: "0" }]);
    expect(map.size).toBe(0);
  });

  it("normalises currency-code case in keys", () => {
    const map = buildOverrideMap([{ base: "jpy", quote: "twd", rate: 0.22 }]);
    expect(map.get(overrideKey("JPY", "TWD"))).toBe(0.22);
  });
});

describe("pinnedRate", () => {
  it("returns the pinned rate when the quote matches", () => {
    expect(pinnedRate({ fxRate: "0.215", fxQuote: "TWD" }, "TWD")).toBe(0.215);
    // numeric column may arrive as string or number; quote compare is case-insensitive
    expect(pinnedRate({ fxRate: 0.215, fxQuote: "twd" }, "TWD")).toBe(0.215);
  });

  it("returns null when the pin targets a different quote currency", () => {
    expect(pinnedRate({ fxRate: "0.215", fxQuote: "TWD" }, "USD")).toBeNull();
  });

  it("returns null when unset or invalid", () => {
    expect(pinnedRate({ fxRate: null, fxQuote: null }, "TWD")).toBeNull();
    expect(pinnedRate({ fxRate: "0", fxQuote: "TWD" }, "TWD")).toBeNull();
    expect(pinnedRate({ fxRate: "-1", fxQuote: "TWD" }, "TWD")).toBeNull();
  });
});

describe("fxDateKey", () => {
  it("uses the Taipei calendar day, not UTC", () => {
    // 2026-03-01 00:30 Taipei is still 2026-02-28 in UTC.
    expect(fxDateKey(new Date("2026-02-28T16:30:00Z"))).toBe("2026-03-01");
    expect(fxDateKey(new Date("2026-03-01T15:59:00Z"))).toBe("2026-03-01");
    expect(fxDateKey(new Date("2026-03-01T16:00:00Z"))).toBe("2026-03-02");
  });

  it("gives the same day for the forms' UTC-noon timestamps", () => {
    expect(fxDateKey(new Date("2026-03-01T12:00:00Z"))).toBe("2026-03-01");
  });
});

describe("spentAtForNow", () => {
  it("is UTC noon of the Taipei day", () => {
    expect(spentAtForNow(new Date("2026-02-28T16:30:00Z")).toISOString()).toBe(
      "2026-03-01T12:00:00.000Z",
    );
  });
});

describe("cacheableRateDay", () => {
  it("caches a past day, even when the API answered with an earlier business day", () => {
    expect(cacheableRateDay("2026-03-01", "2026-03-05", "2026-02-27")).toBe(true);
  });

  it("caches today only when the API's latest is today's", () => {
    expect(cacheableRateDay("2026-03-05", "2026-03-05", "2026-03-05")).toBe(true);
    expect(cacheableRateDay("2026-03-05", "2026-03-05", "2026-03-04")).toBe(false);
  });

  it("never caches a day that hasn't happened yet", () => {
    expect(cacheableRateDay("2026-03-06", "2026-03-05", "2026-03-05")).toBe(false);
  });
});
