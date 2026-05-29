import { describe, expect, it } from "vitest";

import { hexToHslComponents } from "../use-tg-theme";

describe("hexToHslComponents", () => {
  it("converts white", () => {
    expect(hexToHslComponents("#ffffff")).toBe("0 0% 100%");
  });

  it("converts black", () => {
    expect(hexToHslComponents("#000000")).toBe("0 0% 0%");
  });

  it("converts a pure red", () => {
    expect(hexToHslComponents("#ff0000")).toBe("0 100% 50%");
  });

  it("converts a pure green", () => {
    expect(hexToHslComponents("#00ff00")).toBe("120 100% 50%");
  });

  it("converts a pure blue", () => {
    expect(hexToHslComponents("#0000ff")).toBe("240 100% 50%");
  });

  it("returns null for malformed input", () => {
    expect(hexToHslComponents("#fff")).toBeNull();
    expect(hexToHslComponents("ffffff")).toBeNull();
    expect(hexToHslComponents("#gggggg")).toBeNull();
    expect(hexToHslComponents("")).toBeNull();
  });
});
