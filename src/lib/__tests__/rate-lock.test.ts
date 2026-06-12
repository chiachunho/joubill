import { describe, expect, it } from "vitest";

import { affectedCurrencyFor } from "../rate-lock";

describe("affectedCurrencyFor", () => {
  it("returns the base when the quote is the default currency", () => {
    expect(affectedCurrencyFor({ base: "JPY", quote: "TWD" }, "TWD")).toBe("JPY");
  });

  it("returns the quote when the base is the default currency (inverse pair)", () => {
    expect(affectedCurrencyFor({ base: "TWD", quote: "JPY" }, "TWD")).toBe("JPY");
  });

  it("returns null for a dormant pair that doesn't touch the default currency", () => {
    expect(affectedCurrencyFor({ base: "JPY", quote: "TWD" }, "USD")).toBeNull();
  });
});
