import { describe, expect, it } from "vitest";

import { labelMember, labelUser, memberLabels } from "@/lib/label";

describe("labelUser", () => {
  it("uses the chosen name, and 你 for the viewer", () => {
    const p = { userId: 1, displayName: "阿明", firstName: "小明", username: null };
    expect(labelUser(p)).toBe("阿明");
    expect(labelUser(p, 1)).toBe("你");
  });
});

describe("labelMember", () => {
  it("keeps the @username next to a chosen name", () => {
    expect(labelMember({ displayName: "阿明", firstName: "小明", username: "ming" })).toBe(
      "阿明 (@ming)",
    );
  });
});

describe("memberLabels", () => {
  it("leaves distinct labels alone", () => {
    const labels = memberLabels([
      { id: 1, displayName: null, firstName: "Amy", username: null },
      { id: 2, displayName: null, firstName: "Ben", username: null },
    ]);
    expect([...labels.values()]).toEqual(["Amy", "Ben"]);
  });

  it("tells apart two members who chose the same name, by their provider names", () => {
    const labels = memberLabels([
      { id: 1, displayName: "小明", firstName: "王小明", username: null },
      { id: 2, displayName: "小明", firstName: "李小明", username: null },
    ]);
    expect(labels.get(1)).toBe("小明（王小明）");
    expect(labels.get(2)).toBe("小明（李小明）");
  });

  it("numbers them when nothing else differs", () => {
    const labels = memberLabels([
      { id: 1, displayName: null, firstName: "小明", username: null },
      { id: 2, displayName: null, firstName: "小明", username: null },
    ]);
    expect(labels.get(1)).toBe("小明 #1");
    expect(labels.get(2)).toBe("小明 #2");
  });
});
