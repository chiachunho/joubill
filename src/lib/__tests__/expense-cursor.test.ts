import { describe, expect, it } from "vitest";

import { encodeExpenseCursor, parseExpenseCursor } from "@/lib/expense-cursor";

describe("expense cursor", () => {
  const cursor = { spentAt: "2026-03-04", id: 42 };

  it("round-trips through encode and parse", () => {
    expect(encodeExpenseCursor(cursor)).toBe("2026-03-04_42");
    expect(parseExpenseCursor(encodeExpenseCursor(cursor))).toEqual(cursor);
  });

  it.each([
    "",
    "42",
    "garbage_1",
    "2026-03-04_x",
    "2026-99-99_5",
    "2026-02-31_5",
    // The old shape, microsecond text: a stale client page is refused, not misread.
    "2026-03-04T05:06:07.123456Z_5",
  ])("rejects %j", (raw) => {
    expect(parseExpenseCursor(raw)).toBeNull();
  });

  it("rejects an id beyond the int4 range Postgres would refuse", () => {
    expect(parseExpenseCursor("2026-03-04_2147483647")).not.toBeNull();
    expect(parseExpenseCursor("2026-03-04_2147483648")).toBeNull();
    expect(parseExpenseCursor(`2026-03-04_${"9".repeat(30)}`)).toBeNull();
  });
});
