import { describe, expect, it } from "vitest";

import {
  formatAgentLine,
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
  it("renders from → to with the amount", () => {
    expect(formatSettlementNotice(settlement())).toBe(
      '💸 <a href="tg://user?id=111">Alice</a> → <a href="tg://user?id=222">Bob</a>　<b>1,200 TWD</b>',
    );
  });

  it("is a single line — a settlement has no split to show", () => {
    expect(formatSettlementNotice(settlement())).not.toContain("\n");
  });

  it("groups thousands and drops a trailing .00", () => {
    expect(formatSettlementNotice(settlement({ amount: 12000 }))).toContain("<b>12,000 TWD</b>");
    expect(formatSettlementNotice(settlement({ amount: 1800.5 }))).toContain("<b>1,800.50 TWD</b>");
  });

  it("falls back to a plain name for users without a Telegram id", () => {
    expect(formatSettlementNotice(settlement({ payers: [{ user: dave, amount: 1200 }] }))).toBe(
      '💸 Dave → <a href="tg://user?id=222">Bob</a>　<b>1,200 TWD</b>',
    );
  });

  it("escapes HTML in names", () => {
    const text = formatSettlementNotice(
      settlement({
        payers: [{ user: { ...dave, displayName: null, firstName: "<script>" }, amount: 1200 }],
      }),
    );
    expect(text).toContain("💸 &lt;script&gt; →");
  });

  it("survives a settlement missing a side", () => {
    expect(formatSettlementNotice(settlement({ payers: [], splits: [] }))).toBe(
      "💸 轉帳　<b>1,200 TWD</b>",
    );
  });
});

describe("formatDeletedNotice", () => {
  it("names what went, who recorded it and who removed it", () => {
    expect(formatDeletedNotice({ record: expense(), creator: alice, deleter: bob })).toBe(
      '🗑 已刪除 500 TWD（晚餐），原本由 Alice 記錄\n— <a href="tg://user?id=222">Bob</a>',
    );
  });

  it("omits the origin clause when you delete your own record", () => {
    const text = formatDeletedNotice({ record: expense(), creator: alice, deleter: alice });
    expect(text).toBe('🗑 已刪除 500 TWD（晚餐）\n— <a href="tg://user?id=111">Alice</a>');
    expect(text).not.toContain("原本由");
  });

  it("compares people by id, not by name", () => {
    // Two different members who happen to share a display name.
    const twin = { ...alice, userId: 9, username: null, telegramId: 999 };
    expect(formatDeletedNotice({ record: expense(), creator: alice, deleter: twin })).toContain(
      "原本由 Alice 記錄",
    );
  });

  it("drops the description part when there is none", () => {
    const text = formatDeletedNotice({
      record: expense({ description: null }),
      creator: alice,
      deleter: alice,
    });
    expect(text.split("\n")[0]).toBe("🗑 已刪除 500 TWD");
  });

  it("describes a deleted settlement as a transfer", () => {
    expect(
      formatDeletedNotice({ record: settlement(), creator: alice, deleter: bob }).split("\n")[0],
    ).toBe(
      '🗑 已刪除 轉帳 <a href="tg://user?id=111">Alice</a> → <a href="tg://user?id=222">Bob</a> 1,200 TWD，原本由 Alice 記錄',
    );
  });

  it("copes with an unknown creator", () => {
    const text = formatDeletedNotice({ record: expense(), creator: null, deleter: bob });
    expect(text).not.toContain("原本由");
    expect(text).toContain("🗑 已刪除 500 TWD（晚餐）");
  });

  it("escapes HTML in the description and the creator's name", () => {
    const text = formatDeletedNotice({
      record: expense({ description: "<b>x</b> & y" }),
      creator: { ...dave, displayName: null, firstName: "<script>" },
      deleter: bob,
    });
    expect(text).toContain("（&lt;b&gt;x&lt;/b&gt; &amp; y）");
    expect(text).toContain("原本由 &lt;script&gt; 記錄");
  });

  it("keeps the deleter tappable", () => {
    const deleter: NoticePerson & { userId: number } = bob;
    expect(formatDeletedNotice({ record: expense(), creator: null, deleter })).toContain(
      "tg://user?id=222",
    );
  });
});

describe("agent attribution", () => {
  it("writes the line under a card or notice, without a name once the account is gone", () => {
    expect(formatAgentLine(alice, "Claude")).toBe("✦ Alice 透過 Claude 記錄");
    expect(formatAgentLine(null, "Claude")).toBe("✦ 透過 Claude 記錄");
  });

  it("escapes a connection name, which the person typed", () => {
    expect(formatAgentLine(alice, "<b>x</b>")).toBe("✦ Alice 透過 &lt;b&gt;x&lt;/b&gt; 記錄");
  });

  it("adds the line to a settlement notice only when an assistant entered it", () => {
    const plain = formatSettlementNotice(settlement());
    expect(plain).not.toContain("✦");
    const text = formatSettlementNotice(settlement(), { creator: alice, via: "Claude" });
    expect(text.split("\n")).toEqual([plain, "✦ Alice 透過 Claude 記錄"]);
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
      '🗑 已刪除 500 TWD（晚餐），原本由 Alice 透過 Claude 記錄\n— <a href="tg://user?id=222">Bob</a> 透過 我的 n8n',
    );
  });

  it("keeps the assistant in the tombstone when the same person deletes what it entered", () => {
    const text = formatDeletedNotice({
      record: expense(),
      creator: alice,
      deleter: alice,
      creatorVia: "Claude",
    });
    expect(text.split("\n")[0]).toBe("🗑 已刪除 500 TWD（晚餐），原本是透過 Claude 記錄");
  });
});
