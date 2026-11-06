import { describe, expect, it } from "vitest";

import { rateSourceLabel } from "../rate-source-label";

describe("rateSourceLabel", () => {
  it("calls a market rate the day's rate", () => {
    expect(rateSourceLabel(false, { source: "market" })).toBe("當日匯率");
    expect(rateSourceLabel(false, undefined)).toBe("當日匯率");
  });

  it("prefers a typed rate, then the group rate", () => {
    expect(rateSourceLabel(true, { source: "group" })).toBe("此筆自訂匯率");
    expect(rateSourceLabel(false, { source: "group" })).toBe("群組自訂匯率");
  });
});
