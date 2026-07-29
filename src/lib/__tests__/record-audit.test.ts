import { describe, expect, it } from "vitest";

import {
  diffRecords,
  isRateLockPayload,
  rateLockTouches,
  summariseRecord,
  type RateLockPayload,
  type RecordSnapshot,
} from "@/lib/record-audit";

const alice = { userId: 1, firstName: "Alice", lastName: null, username: "alice", telegramId: 111 };
const bob = { userId: 2, firstName: "Bob", lastName: null, username: "bob", telegramId: 222 };
const carol = { userId: 3, firstName: "Carol", lastName: null, username: null, telegramId: 333 };

function snapshot(over: Partial<RecordSnapshot> = {}): RecordSnapshot {
  return {
    type: "expense",
    amount: 1200,
    currency: "TWD",
    description: "晚餐",
    spentAt: "2026-07-25T12:00:00.000Z",
    fxRate: null,
    fxQuote: null,
    receipts: 0,
    payers: [{ user: alice, amount: 1200 }],
    splits: [
      { user: alice, amount: 600 },
      { user: bob, amount: 600 },
    ],
    ...over,
  };
}

describe("diffRecords", () => {
  it("reports nothing when a rewrite changes no values", () => {
    // The PATCH route replaces payers and splits wholesale on every save, so an
    // identical re-save must not turn into a log row nobody wants to read.
    expect(diffRecords(snapshot(), snapshot())).toEqual([]);
  });

  it("treats reordered legs as unchanged", () => {
    const reordered = snapshot({
      splits: [
        { user: bob, amount: 600 },
        { user: alice, amount: 600 },
      ],
    });
    expect(diffRecords(snapshot(), reordered)).toEqual([]);
  });

  it("keeps amount and currency as separate rows", () => {
    // Collapsed into one line, a pure currency change would read as if the
    // number had moved too.
    const changed = diffRecords(snapshot(), snapshot({ amount: 1600, currency: "JPY" }));
    expect(changed.map((c) => c.key)).toEqual(["amount", "currency"]);
    expect(changed[0]).toMatchObject({ label: "金額", before: "1,200", after: "1,600" });
    expect(changed[1]).toMatchObject({ label: "幣別", before: "TWD", after: "JPY" });
  });

  it("reports a currency change on its own", () => {
    const changed = diffRecords(snapshot(), snapshot({ currency: "JPY" }));
    expect(changed).toHaveLength(1);
    expect(changed[0].key).toBe("currency");
  });

  it("reports a rescaled total once, not once per leg", () => {
    // Dropping 1,000 → 100 rescales the payer's contribution and the single
    // share along with it. Reported per-leg, one edit reads as three changes,
    // two of which render as "Alice → Alice".
    const before = snapshot({
      amount: 1000,
      payers: [{ user: alice, amount: 1000 }],
      splits: [{ user: alice, amount: 1000 }],
    });
    const after = snapshot({
      amount: 100,
      payers: [{ user: alice, amount: 100 }],
      splits: [{ user: alice, amount: 100 }],
    });
    expect(diffRecords(before, after).map((c) => c.key)).toEqual(["amount"]);
  });

  it("still reports a redistribution that leaves the total alone", () => {
    const after = snapshot({
      splits: [
        { user: alice, amount: 900 },
        { user: bob, amount: 300 },
      ],
    });
    const [change] = diffRecords(snapshot(), after);
    // Amounts, not "2 人 → 2 人", which would say nothing.
    expect(change).toMatchObject({
      key: "splits",
      before: "Alice 600、Bob 600",
      after: "Alice 900、Bob 300",
    });
  });

  it("drops any row whose two sides read identically", () => {
    // Whatever produced it, "X → X" is not a change a reader can use.
    for (const change of diffRecords(snapshot(), snapshot({ amount: 2400 }))) {
      expect(change.before).not.toBe(change.after);
    }
  });

  it("names who left and who joined a split", () => {
    const after = snapshot({
      splits: [
        { user: alice, amount: 600 },
        { user: carol, amount: 600 },
      ],
    });
    const [change] = diffRecords(snapshot(), after);
    expect(change).toMatchObject({
      key: "splits",
      label: "分帳",
      before: "2 人",
      after: "2 人",
      detail: "移除 Bob · 新增 Carol",
    });
  });

  it("reports a split whose amounts moved without its membership", () => {
    const after = snapshot({
      splits: [
        { user: alice, amount: 900 },
        { user: bob, amount: 300 },
      ],
    });
    const [change] = diffRecords(snapshot(), after);
    expect(change.key).toBe("splits");
    // Same people, so there is no membership delta to name.
    expect(change.detail).toBeUndefined();
  });

  it("renders a missing description and a missing pin as words, not blanks", () => {
    const changed = diffRecords(
      snapshot({ description: null, fxRate: null, fxQuote: null }),
      snapshot({ description: "宵夜", fxRate: 0.213, fxQuote: "TWD" }),
    );
    expect(changed.find((c) => c.key === "description")).toMatchObject({
      before: "（無）",
      after: "宵夜",
    });
    expect(changed.find((c) => c.key === "fx")).toMatchObject({
      before: "自動",
      after: "0.213 TWD",
    });
  });

  it("ignores a spentAt change that stays on the same day", () => {
    // The form submits a whole timestamp; only the date is shown, so a
    // same-day round trip is not a change anyone can see.
    const after = snapshot({ spentAt: "2026-07-25T18:30:00.000Z" });
    expect(diffRecords(snapshot(), after)).toEqual([]);
  });

  it("reports a receipt being attached", () => {
    const [change] = diffRecords(snapshot(), snapshot({ receipts: 1 }));
    expect(change).toMatchObject({ key: "receipts", before: "0 張", after: "1 張" });
  });
});

describe("summariseRecord", () => {
  it("describes an expense by its split size", () => {
    expect(summariseRecord(snapshot())).toBe("1,200 TWD · 2 人分帳");
  });

  it("describes a settlement by its direction", () => {
    const stl = snapshot({
      type: "settlement",
      description: null,
      payers: [{ user: alice, amount: 800 }],
      splits: [{ user: bob, amount: 800 }],
    });
    expect(summariseRecord(stl)).toBe("1,200 TWD · Alice → Bob");
  });
});

describe("rate lock payloads", () => {
  const payload: RateLockPayload = {
    kind: "rateLock",
    base: "JPY",
    quote: "TWD",
    rate: 0.213,
    expenseIds: [10, 11],
    settlementIds: [20],
  };

  it("recognises its own shape and rejects a record snapshot", () => {
    expect(isRateLockPayload(payload)).toBe(true);
    expect(isRateLockPayload(snapshot())).toBe(false);
    expect(isRateLockPayload(null)).toBe(false);
  });

  it("knows which records it rewrote", () => {
    // This is what keeps a single record's history from showing an
    // unexplained rate jump.
    expect(rateLockTouches(payload, 11)).toBe(true);
    expect(rateLockTouches(payload, 20)).toBe(true);
    expect(rateLockTouches(payload, 99)).toBe(false);
  });
});
