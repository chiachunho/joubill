import { describe, expect, it } from "vitest";

import { encodeExpenseCursor, parseExpenseCursor } from "@/lib/expense-cursor";

describe("expense cursor", () => {
  const cursor = { spentAt: "2026-03-04T05:06:07.123456Z", id: 42 };

  it("round-trips through encode and parse, microseconds included", () => {
    expect(parseExpenseCursor(encodeExpenseCursor(cursor))).toEqual(cursor);
  });

  it.each([
    "",
    "42",
    "garbage_1",
    "2026-03-04T05:06:07Z_1",
    "2026-03-04T05:06:07.123456Z_x",
    "2026-99-99T99:99:99.000000Z_5",
    "2026-02-31T05:06:07.123456Z_5",
    "2026-03-04T25:06:07.123456Z_5",
  ])("rejects %j", (raw) => {
    expect(parseExpenseCursor(raw)).toBeNull();
  });

  it("rejects an id beyond the int4 range Postgres would refuse", () => {
    expect(parseExpenseCursor("2026-03-04T05:06:07.123456Z_2147483647")).not.toBeNull();
    expect(parseExpenseCursor("2026-03-04T05:06:07.123456Z_2147483648")).toBeNull();
    expect(parseExpenseCursor(`2026-03-04T05:06:07.123456Z_${"9".repeat(30)}`)).toBeNull();
  });
});
