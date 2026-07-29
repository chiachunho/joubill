import { describe, expect, it } from "vitest";

import { dayLabel, stampLabel } from "@/lib/format";

const now = new Date(2026, 6, 28, 10, 0); // 2026-07-28 local

describe("stampLabel", () => {
  it("drops the year within the current one", () => {
    expect(stampLabel(new Date(2026, 6, 25, 20, 14), now)).toBe("7/25 20:14");
  });

  it("keeps the year for anything older", () => {
    expect(stampLabel(new Date(2025, 11, 31, 9, 5), now)).toBe("2025/12/31 9:05");
  });

  it("pads minutes but not hours", () => {
    expect(stampLabel(new Date(2026, 6, 25, 9, 5), now)).toBe("7/25 9:05");
  });

  it("returns an empty string for an unparseable value rather than 'Invalid Date'", () => {
    expect(stampLabel("not a date", now)).toBe("");
  });
});

describe("dayLabel", () => {
  it("names today and yesterday", () => {
    expect(dayLabel(new Date(2026, 6, 28, 1, 0), now)).toBe("今天");
    expect(dayLabel(new Date(2026, 6, 27, 23, 59), now)).toBe("昨天");
  });

  it("compares calendar days, not elapsed hours", () => {
    // 22 hours earlier, but a different date — "昨天", not "今天".
    expect(dayLabel(new Date(2026, 6, 27, 12, 0), now)).toBe("昨天");
  });

  it("uses a bare date within the year and adds the year before it", () => {
    expect(dayLabel(new Date(2026, 6, 25), now)).toBe("7月25日");
    expect(dayLabel(new Date(2025, 6, 25), now)).toBe("2025年7月25日");
  });
});
