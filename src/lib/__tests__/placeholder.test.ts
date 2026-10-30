import { describe, expect, it } from "vitest";

import { isDuplicateName, nameKey, placeholderNameSchema } from "../placeholder";

describe("placeholderNameSchema", () => {
  it("trims and collapses whitespace", () => {
    expect(placeholderNameSchema.parse("  小   明 ")).toBe("小 明");
  });
  it("rejects empty and over-long names", () => {
    expect(placeholderNameSchema.safeParse("   ").success).toBe(false);
    expect(placeholderNameSchema.safeParse("x".repeat(31)).success).toBe(false);
  });
});

describe("isDuplicateName", () => {
  const members = [
    { id: 1, displayName: null, firstName: "Amy", lastName: "Lee" },
    { id: 2, displayName: null, firstName: "小明", lastName: null },
  ];
  it("ignores case and spacing", () => {
    expect(nameKey(" AMY  lee")).toBe("amy lee");
    expect(isDuplicateName("amy lee", members)).toBe(true);
  });
  it("lets a rename keep its own name", () => {
    expect(isDuplicateName("小明", members, 2)).toBe(false);
    expect(isDuplicateName("小明", members, 1)).toBe(true);
  });
  it("compares against the name a member chose, not their provider name", () => {
    const chosen = [{ id: 3, displayName: "阿華", firstName: "Hua Chen", lastName: null }];
    expect(isDuplicateName("阿華", chosen)).toBe(true);
    expect(isDuplicateName("Hua Chen", chosen)).toBe(false);
  });
  it("accepts a new name", () => {
    expect(isDuplicateName("阿華", members)).toBe(false);
  });
});
