import { describe, expect, it } from "vitest";

import { rateSourceLabel } from "../rate-source-label";

describe("rateSourceLabel", () => {
  it("calls a market rate the day's market rate", () => {
    expect(rateSourceLabel({ source: "market" })).toBe("當日市場匯率");
    expect(rateSourceLabel({ source: null })).toBe("當日市場匯率");
    expect(rateSourceLabel(undefined)).toBe("當日市場匯率");
  });

  it("names a group rate", () => {
    expect(rateSourceLabel({ source: "group" })).toBe("群組自訂匯率");
  });
});
