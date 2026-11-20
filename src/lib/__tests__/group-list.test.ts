import { describe, expect, it } from "vitest";

import { parseGroupSort, sortGroups, standingOf, updatedLabel } from "@/lib/group-list";

const now = new Date(2026, 10, 20, 15, 0); // 2026-11-20 15:00 local

describe("sortGroups", () => {
  const groups = [
    { id: 1, title: "露營", lastActivityAt: "2026-11-18T00:00:00Z" },
    { id: 2, title: "LSTJ", lastActivityAt: "2026-11-20T06:00:00Z" },
    { id: 3, title: "北海道花錢", lastActivityAt: "2026-10-05T00:00:00Z" },
    { id: 4, title: "LSTJ", lastActivityAt: "2026-10-05T00:00:00Z" },
  ];

  it("puts the most recently changed group first", () => {
    // 3 and 4 changed at the same time, so the name decides (zh-Hant puts 漢字 before Latin).
    expect(sortGroups(groups, "recent").map((g) => g.id)).toEqual([2, 1, 3, 4]);
  });

  it("sorts by name in zh-Hant order, then most recent for equal names", () => {
    // 北 (5 strokes) before 露 (20), Latin after 漢字; the newer LSTJ first.
    expect(sortGroups(groups, "name").map((g) => g.id)).toEqual([3, 1, 2, 4]);
  });

  it("does not reorder the input", () => {
    sortGroups(groups, "name");
    expect(groups.map((g) => g.id)).toEqual([1, 2, 3, 4]);
  });
});

describe("parseGroupSort", () => {
  it("defaults to recent for anything unknown", () => {
    expect(parseGroupSort(null)).toBe("recent");
    expect(parseGroupSort("bogus")).toBe("recent");
    expect(parseGroupSort("name")).toBe("name");
  });
});

describe("updatedLabel", () => {
  const at = (d: Date) => d.toISOString();
  it("reads minutes, hours, yesterday, days, then a date", () => {
    expect(updatedLabel(at(new Date(2026, 10, 20, 14, 59, 40)), now)).toBe("剛剛更新");
    expect(updatedLabel(at(new Date(2026, 10, 20, 14, 55)), now)).toBe("5 分鐘前更新");
    expect(updatedLabel(at(new Date(2026, 10, 20, 12, 0)), now)).toBe("3 小時前更新");
    expect(updatedLabel(at(new Date(2026, 10, 19, 23, 0)), now)).toBe("昨天更新");
    expect(updatedLabel(at(new Date(2026, 10, 17, 9, 0)), now)).toBe("3 天前更新");
    expect(updatedLabel(at(new Date(2026, 10, 2, 9, 0)), now)).toBe("11/2 更新");
    expect(updatedLabel(at(new Date(2025, 2, 14, 9, 0)), now)).toBe("2025/3/14 更新");
  });

  it("is empty for an unreadable time", () => {
    expect(updatedLabel("nope", now)).toBe("");
  });
});

describe("standingOf", () => {
  it("treats less than a cent as settled", () => {
    expect(standingOf(0)).toBe("settled");
    expect(standingOf(0.004)).toBe("settled");
    expect(standingOf(150)).toBe("receive");
    expect(standingOf(-0.01)).toBe("pay");
  });
});
