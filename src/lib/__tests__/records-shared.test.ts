import { describe, expect, it } from "vitest";

import { keepsDormantPin } from "@/lib/records/shared";

const base = {
  inputFxRate: null,
  inputCurrency: "JPY",
  existing: { currency: "JPY", fxQuote: "USD" },
  defaultCurrency: "TWD",
};

describe("keepsDormantPin", () => {
  it("keeps a pin stamped for another default when the rate field is blank", () => {
    expect(keepsDormantPin(base)).toBe(true);
  });

  it("does not keep it when a rate is typed", () => {
    expect(keepsDormantPin({ ...base, inputFxRate: 0.22 })).toBe(false);
  });

  it("does not keep it when the currency changed", () => {
    expect(keepsDormantPin({ ...base, inputCurrency: "USD" })).toBe(false);
  });

  it("does not keep an active pin (quote equals the current default)", () => {
    expect(keepsDormantPin({ ...base, defaultCurrency: "USD" })).toBe(false);
  });

  it("has nothing to keep without a pin", () => {
    expect(keepsDormantPin({ ...base, existing: { currency: "JPY", fxQuote: null } })).toBe(false);
  });
});
