import { describe, expect, it } from "vitest";

import {
  formatMcpLine,
  formatDeletedNotice,
  formatSettlementNotice,
  type NoticePerson,
  type NoticeRecord,
} from "@/lib/record-notice";

const alice = {
  userId: 1,
  displayName: null,
  firstName: "Alice",
  lastName: null,
  username: "alice",
  telegramId: 111,
};
const bob = {
  userId: 2,
  displayName: null,
  firstName: "Bob",
  lastName: null,
  username: "bob",
  telegramId: 222,
};
/** A web-only user: no Telegram account, so no tappable mention is possible. */
const dave = {
  userId: 4,
  displayName: null,
  firstName: "Dave",
  lastName: null,
  username: null,
  telegramId: null,
};

function settlement(over: Partial<NoticeRecord> = {}): NoticeRecord {
  return {
    type: "settlement",
    amount: 1200,
    currency: "TWD",
    description: null,
    payers: [{ user: alice, amount: 1200 }],
    splits: [{ user: bob, amount: 1200 }],
    ...over,
  };
}

function expense(over: Partial<NoticeRecord> = {}): NoticeRecord {
  return {
    type: "expense",
    amount: 500,
    currency: "TWD",
    description: "晚餐",
    payers: [{ user: alice, amount: 500 }],
    splits: [
      { user: alice, amount: 250 },
      { user: bob, amount: 250 },
    ],
    ...over,
  };
}

describe("formatSettlementNotice", () => {
  it("says it is a repayment and how much, then who paid whom", () => {
    expect(formatSettlementNotice(settlement())).toBe(
      '💸 <b>還款　1,200 TWD</b>\n<a href="tg://user?id=111">Alice</a> → <a href="tg://user?id=222">Bob</a>',
    );
  });

  it("groups thousands and drops a trailing .00", () => {
    expect(formatSettlementNotice(settlement({ amount: 12000 }))).toContain(
      "<b>還款　12,000 TWD</b>",
    );
    expect(formatSettlementNotice(settlement({ amount: 1800.5 }))).toContain(
      "<b>還款　1,800.50 TWD</b>",
    );
  });

  it("falls back to a plain name for users without a Telegram id", () => {
    expect(
      formatSettlementNotice(settlement({ payers: [{ user: dave, amount: 1200 }] })).split("\n")[1],
    ).toBe('Dave → <a href="tg://user?id=222">Bob</a>');
  });

  it("escapes HTML in names", () => {
    const text = formatSettlementNotice(
      settlement({
        payers: [{ user: { ...dave, displayName: null, firstName: "<script>" }, amount: 1200 }],
      }),
    );
    expect(text).toContain("&lt;script&gt; →");
  });

  it("survives a settlement missing a side", () => {
    expect(formatSettlementNotice(settlement({ payers: [], splits: [] }))).toBe(
      "💸 <b>還款　1,200 TWD</b>",
    );
  });
});

describe("formatDeletedNotice", () => {
  it("strikes out what went, then says who recorded it and who removed it", () => {
    expect(formatDeletedNotice({ record: expense(), creator: alice, deleter: bob })).toBe(
      '🗑 <s>晚餐　500 TWD</s>\nAlice 記錄 · <a href="tg://user?id=222">Bob</a> 刪除',
    );
  });

  it("names only the deleter when you delete your own record", () => {
    const text = formatDeletedNotice({ record: expense(), creator: alice, deleter: alice });
    expect(text).toBe('🗑 <s>晚餐　500 TWD</s>\n<a href="tg://user?id=111">Alice</a> 刪除');
    expect(text).not.toContain("記錄");
  });

  it("compares people by id, not by name", () => {
    // Two different members who happen to share a display name.
    const twin = { ...alice, userId: 9, username: null, telegramId: 999 };
    expect(formatDeletedNotice({ record: expense(), creator: alice, deleter: twin })).toContain(
      "Alice 記錄 · ",
    );
  });

  it("drops the description part when there is none", () => {
    const text = formatDeletedNotice({
      record: expense({ description: null }),
      creator: alice,
      deleter: alice,
    });
    expect(text.split("\n")[0]).toBe("🗑 <s>500 TWD</s>");
  });

  it("describes a deleted settlement as a transfer", () => {
    expect(formatDeletedNotice({ record: settlement(), creator: alice, deleter: bob })).toBe(
      '🗑 <s>還款 Alice → Bob　1,200 TWD</s>\nAlice 記錄 · <a href="tg://user?id=222">Bob</a> 刪除',
    );
  });

  it("copes with an unknown creator", () => {
    const text = formatDeletedNotice({ record: expense(), creator: null, deleter: bob });
    expect(text).not.toContain("記錄");
    expect(text).toContain("🗑 <s>晚餐　500 TWD</s>");
  });

  it("escapes HTML in the description and the creator's name", () => {
    const text = formatDeletedNotice({
      record: expense({ description: "<b>x</b> & y" }),
      creator: { ...dave, displayName: null, firstName: "<script>" },
      deleter: bob,
    });
    expect(text).toContain("<s>&lt;b&gt;x&lt;/b&gt; &amp; y　500 TWD</s>");
    expect(text).toContain("&lt;script&gt; 記錄");
  });

  it("keeps the deleter tappable", () => {
    const deleter: NoticePerson & { userId: number } = bob;
    expect(formatDeletedNotice({ record: expense(), creator: null, deleter })).toContain(
      "tg://user?id=222",
    );
  });
});

describe("linked application attribution", () => {
  it("writes the line under a card or notice, without a name once the account is gone", () => {
    expect(formatMcpLine(alice, "Claude")).toBe("✦ Alice 透過 Claude 記錄");
    expect(formatMcpLine(null, "Claude")).toBe("✦ 透過 Claude 記錄");
  });

  it("escapes a connection name, which the person typed", () => {
    expect(formatMcpLine(alice, "<b>x</b>")).toBe("✦ Alice 透過 &lt;b&gt;x&lt;/b&gt; 記錄");
  });

  it("adds the line to a settlement notice only when an assistant entered it", () => {
    const plain = formatSettlementNotice(settlement());
    expect(plain).not.toContain("✦");
    const text = formatSettlementNotice(settlement(), { creator: alice, via: "Claude" });
    expect(text.split("\n")).toEqual([...plain.split("\n"), "✦ Alice 透過 Claude 記錄"]);
  });

  it("says in the tombstone which assistant entered the record and which one deleted it", () => {
    expect(
      formatDeletedNotice({
        record: expense(),
        creator: alice,
        deleter: bob,
        creatorVia: "Claude",
        deleterVia: "我的 n8n",
      }),
    ).toBe(
      '🗑 <s>晚餐　500 TWD</s>\nAlice 透過 Claude 記錄 · <a href="tg://user?id=222">Bob</a> 透過 我的 n8n 刪除',
    );
  });

  it("keeps the assistant in the tombstone when the same person deletes what it entered", () => {
    const text = formatDeletedNotice({
      record: expense(),
      creator: alice,
      deleter: alice,
      creatorVia: "Claude",
    });
    expect(text.split("\n")[1]).toBe(
      '透過 Claude 記錄 · <a href="tg://user?id=111">Alice</a> 刪除',
    );
  });
});
