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
    { id: 1, firstName: "Amy", lastName: "Lee" },
    { id: 2, firstName: "小明", lastName: null },
  ];
  it("ignores case and spacing", () => {
    expect(nameKey(" AMY  lee")).toBe("amy lee");
    expect(isDuplicateName("amy lee", members)).toBe(true);
  });
  it("lets a rename keep its own name", () => {
    expect(isDuplicateName("小明", members, 2)).toBe(false);
    expect(isDuplicateName("小明", members, 1)).toBe(true);
  });
  it("accepts a new name", () => {
    expect(isDuplicateName("阿華", members)).toBe(false);
  });
});
