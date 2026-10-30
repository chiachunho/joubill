import { describe, expect, it } from "vitest";

import {
  changeHeading,
  claimTouches,
  diffRecords,
  isGroupEventPayload,
  isRateLockPayload,
  rateLockImpact,
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

describe("diffRecords — the field shapes that had no coverage", () => {
  it("renders a real date change", () => {
    // Only the same-day non-change was covered before, so nothing pinned what
    // an actual date move looks like.
    const [change] = diffRecords(snapshot(), snapshot({ spentAt: "2026-08-01T09:00:00.000Z" }));
    expect(change).toMatchObject({
      key: "spentAt",
      label: "日期",
      before: "2026/7/25",
      after: "2026/8/1",
    });
  });

  it("names the payers when who paid changes", () => {
    const after = snapshot({ payers: [{ user: bob, amount: 1200 }] });
    const [change] = diffRecords(snapshot(), after);
    expect(change).toMatchObject({
      key: "payers",
      label: "付款人",
      before: "Alice",
      after: "Bob",
      detail: "移除 Alice · 新增 Bob",
    });
  });

  it("shows per-payer amounts when the same people split the bill differently", () => {
    const before = snapshot({
      payers: [
        { user: alice, amount: 1200 },
        { user: bob, amount: 0 },
      ],
    });
    const after = snapshot({
      payers: [
        { user: alice, amount: 200 },
        { user: bob, amount: 1000 },
      ],
    });
    const [change] = diffRecords(before, after);
    expect(change).toMatchObject({
      key: "payers",
      before: "Alice 1,200、Bob 0",
      after: "Alice 200、Bob 1,000",
    });
    expect(change.detail).toBeUndefined();
  });

  it("reverts a pinned rate back to automatic", () => {
    const [change] = diffRecords(
      snapshot({ fxRate: 0.213, fxQuote: "TWD" }),
      snapshot({ fxRate: null, fxQuote: null }),
    );
    expect(change).toMatchObject({ key: "fx", before: "0.213 TWD", after: "自動" });
  });

  it("counts an empty side rather than calling it （無）", () => {
    // Nobody splitting is still a head-count, and the 新增 detail names who
    // arrived. The （無） fallback the legs used to carry was unreachable:
    // getting to it needs matching membership, and two empty sides match.
    const [change] = diffRecords(snapshot({ splits: [] }), snapshot());
    expect(change).toMatchObject({
      key: "splits",
      before: "0 人",
      after: "2 人",
      detail: "新增 Alice、Bob",
    });
  });
});

describe("changeHeading", () => {
  const base = { recordType: "expense", recordLabel: "晚餐" };

  it("names the record on the feed and the kind on its own page", () => {
    expect(changeHeading({ ...base, action: "created" }, true)).toBe("新增了 晚餐");
    expect(changeHeading({ ...base, action: "created" }, false)).toBe("新增了支出");
    expect(changeHeading({ ...base, action: "deleted" }, true)).toBe("刪除了 晚餐");
  });

  it("calls a settlement a 還款", () => {
    expect(changeHeading({ action: "created", recordType: "settlement" }, false)).toBe(
      "新增了還款",
    );
  });

  it("falls back to the kind when a record has no description", () => {
    expect(changeHeading({ ...base, recordLabel: "  ", action: "deleted" }, true)).toBe(
      "刪除了 支出",
    );
  });

  it("lists the changed fields on a record's own page", () => {
    const changes = diffRecords(snapshot(), snapshot({ amount: 1600, currency: "JPY" }));
    expect(changeHeading({ ...base, action: "updated", changes }, false)).toBe("改了金額、幣別");
    // On the feed the same entry names the record instead — the fields are
    // spelled out on the line below it either way.
    expect(changeHeading({ ...base, action: "updated", changes }, true)).toBe("改了 晚餐");
  });

  it("does not claim fields changed when the diff came back empty", () => {
    expect(changeHeading({ ...base, action: "updated", changes: [] }, false)).toBe("改了內容");
  });

  it("states the locked rate, and copes with a deleted one", () => {
    expect(
      changeHeading(
        { action: "rate_locked", recordType: "group", rateLock: { base: "JPY", rate: 0.213 } },
        true,
      ),
    ).toBe("鎖定了 JPY 匯率 0.213");
    expect(
      changeHeading(
        { action: "rate_locked", recordType: "group", rateLock: { base: "JPY", rate: null } },
        true,
      ),
    ).toBe("鎖定了 JPY 匯率");
  });
});

describe("changeHeading chat_linked", () => {
  it("names the chat the group was bound to", () => {
    expect(
      changeHeading(
        { action: "chat_linked", recordType: "group", groupEvent: { chatTitle: "日本行" } },
        true,
      ),
    ).toBe("綁定了 Telegram 群組（日本行）");
  });

  it("still reads without a title", () => {
    expect(changeHeading({ action: "chat_linked", recordType: "group" }, true)).toBe(
      "綁定了 Telegram 群組",
    );
  });
});

describe("rateLockImpact", () => {
  it("leaves out a kind that nothing happened to", () => {
    expect(rateLockImpact({ expenses: 12, settlements: 3 })).toBe("影響 12 筆支出 · 3 筆轉帳");
    expect(rateLockImpact({ expenses: 12, settlements: 0 })).toBe("影響 12 筆支出");
    expect(rateLockImpact({ expenses: 0, settlements: 3 })).toBe("影響 3 筆轉帳");
  });

  it("says so rather than rendering a dangling 影響", () => {
    expect(rateLockImpact({ expenses: 0, settlements: 0 })).toBe("沒有影響既有紀錄");
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

describe("changeHeading member_claimed", () => {
  it("reads as the claimer taking the name", () => {
    expect(
      changeHeading(
        { action: "member_claimed", recordType: "group", groupEvent: { claimedName: "小明" } },
        true,
      ),
    ).toBe("認領了 小明");
  });

  it("names the target when someone else did the merge", () => {
    expect(
      changeHeading(
        {
          action: "member_claimed",
          recordType: "group",
          groupEvent: { claimedName: "小明", claimerName: "Amy" },
        },
        true,
      ),
    ).toBe("把 小明 合併到 Amy");
  });

  it("is recognised as a group event and a record's touch", () => {
    const payload = {
      kind: "memberClaimed" as const,
      placeholderId: 3,
      placeholderName: "小明",
      claimerId: 4,
      claimerName: "Chia",
      recordIds: [7, 9],
    };
    expect(isGroupEventPayload(payload)).toBe(true);
    expect(claimTouches(payload, 9)).toBe(true);
    expect(claimTouches(payload, 8)).toBe(false);
  });
});
