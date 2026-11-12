import { describe, expect, it } from "vitest";

import { expenseEditPath, focusesReceipts } from "@/lib/record-path";

const searchOf = (path: string) => new URL(path, "https://example.test").searchParams;

describe("expenseEditPath", () => {
  it("points at the edit form", () => {
    expect(expenseEditPath("/app", 3, 41)).toBe("/app/groups/3/expenses/41/edit");
    expect(focusesReceipts(searchOf(expenseEditPath("/app", 3, 41)))).toBe(false);
  });

  it("round-trips the receipts focus through the query string", () => {
    const path = expenseEditPath("/app", 3, 41, { focus: "receipts" });
    expect(path.startsWith("/app/groups/3/expenses/41/edit?")).toBe(true);
    expect(focusesReceipts(searchOf(path))).toBe(true);
  });

  it("is not set by anything else", () => {
    expect(focusesReceipts(null)).toBe(false);
    expect(focusesReceipts(searchOf("/x?focus=split"))).toBe(false);
  });
});
