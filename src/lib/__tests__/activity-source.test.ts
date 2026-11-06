import { describe, expect, it } from "vitest";

import { ACTIVITY_SOURCES, ACTIVITY_SOURCE_LABEL, parseActivitySource } from "../activity-source";

describe("parseActivitySource", () => {
  it("reads a missing parameter as everything, and refuses an unknown one", () => {
    expect(parseActivitySource(null)).toBe("all");
    expect(parseActivitySource("mcp")).toBe("mcp");
    expect(parseActivitySource("manual")).toBe("manual");
    expect(parseActivitySource("agent")).toBeUndefined();
    expect(parseActivitySource("")).toBeUndefined();
  });
  it("labels every source with the wording from issue #147", () => {
    expect(ACTIVITY_SOURCES.map((s) => ACTIVITY_SOURCE_LABEL[s])).toEqual([
      "全部",
      "手動記錄",
      "透過應用程式",
    ]);
  });
});
