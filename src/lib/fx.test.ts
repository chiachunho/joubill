import { describe, expect, it } from "vitest";

import { getRate, parseFxResponse } from "./fx";

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
});
