import { describe, expect, it } from "vitest";

import { parsePickCallback, PICK_KINDS, pickCallback } from "../groupPicker";
import { parseSettleCallback, settleCallback } from "../groupViews";

describe("pick callback", () => {
  it("round-trips every kind", () => {
    for (const kind of PICK_KINDS) {
      expect(parsePickCallback(pickCallback(kind, 12))).toEqual({ kind, groupId: 12 });
    }
  });

  it("rejects a kind it doesn't handle and malformed data", () => {
    expect(parsePickCallback("pick:delete:12")).toBeNull();
    expect(parsePickCallback("pick:add:")).toBeNull();
    expect(parsePickCallback("pick:add:12:3")).toBeNull();
  });

  it("fits Telegram's 64-byte callback limit", () => {
    expect(Buffer.byteLength(pickCallback("balance", 2_147_483_647))).toBeLessThanOrEqual(64);
  });
});

describe("settle callback", () => {
  it("round-trips", () => {
    expect(parseSettleCallback(settleCallback(7))).toBe(7);
    expect(parseSettleCallback("settle:x")).toBeNull();
  });
});
