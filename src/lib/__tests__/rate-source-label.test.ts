import { describe, expect, it } from "vitest";

import { rateSourceLabel } from "../rate-source-label";

describe("rateSourceLabel", () => {
  it("names the market rate's day", () => {
    expect(rateSourceLabel(false, { source: "market", marketRateDate: "2026-03-01" })).toBe(
      "市場匯率 · 2026/03/01",
    );
  });

  it("omits the day when unknown", () => {
    expect(rateSourceLabel(false, { source: "market", marketRateDate: null })).toBe("市場匯率");
    expect(rateSourceLabel(false, undefined)).toBe("市場匯率");
  });

  it("prefers a typed rate, then the group rate, over the market day", () => {
    const eff = { source: "group", marketRateDate: "2026-03-01" };
    expect(rateSourceLabel(true, eff)).toBe("此筆自訂匯率");
    expect(rateSourceLabel(false, eff)).toBe("群組自訂匯率");
  });
});
