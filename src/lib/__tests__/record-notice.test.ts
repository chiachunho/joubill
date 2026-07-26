import { describe, expect, it } from "vitest";

import { formatRecordNotice, type NoticePerson, type NoticeRecord } from "@/lib/record-notice";

const alice: NoticePerson = {
  firstName: "Alice",
  lastName: null,
  username: "alice",
  telegramId: 111,
};
const bob: NoticePerson = { firstName: "Bob", lastName: null, username: "bob", telegramId: 222 };
const carol: NoticePerson = {
  firstName: "Carol",
  lastName: null,
  username: null,
  telegramId: 333,
};
/** A web-only user: no Telegram account, so no tappable mention is possible. */
const dave: NoticePerson = { firstName: "Dave", lastName: null, username: null, telegramId: null };

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

describe("formatRecordNotice — expense", () => {
  it("renders payer, amount, description and an equal split", () => {
    expect(formatRecordNotice(expense())).toBe(
      '<a href="tg://user?id=111">Alice</a> 付了 <b>500 TWD</b>（晚餐）\n' +
        '<a href="tg://user?id=111">Alice</a>、<a href="tg://user?id=222">Bob</a> 各 250',
    );
  });

  it("omits the description part when there is none", () => {
    const text = formatRecordNotice(expense({ description: null }));
    expect(text).toContain("<b>500 TWD</b>\n");
    expect(text).not.toContain("（");
  });

  it("lists per-person amounts when shares differ", () => {
    const text = formatRecordNotice(
      expense({
        splits: [
          { user: alice, amount: 300 },
          { user: bob, amount: 200 },
        ],
      }),
    );
    expect(text).toContain('Alice</a> 300、<a href="tg://user?id=222">Bob</a> 200');
    expect(text).not.toContain("各");
  });

  it("gives each payer their own amount when there are several", () => {
    const text = formatRecordNotice(
      expense({
        payers: [
          { user: alice, amount: 300 },
          { user: bob, amount: 200 },
        ],
      }),
    );
    expect(text.split("\n")[0]).toBe(
      '<a href="tg://user?id=111">Alice</a> 300、<a href="tg://user?id=222">Bob</a> 200 付了 <b>500 TWD</b>（晚餐）',
    );
  });

  it("does not say 各 for a single debtor", () => {
    const text = formatRecordNotice(expense({ splits: [{ user: alice, amount: 500 }] }));
    expect(text.split("\n")[1]).toBe('<a href="tg://user?id=111">Alice</a> 500');
  });

  it("treats cent-equal shares as equal", () => {
    const text = formatRecordNotice(
      expense({
        amount: 10,
        splits: [
          { user: alice, amount: 3.34 },
          { user: bob, amount: 3.33 },
          { user: carol, amount: 3.33 },
        ],
      }),
    );
    // 3.34 / 3.33 / 3.33 are genuinely different — must not collapse to 各.
    expect(text).toContain("3.34");
    expect(text).not.toContain("各");
  });

  it("groups thousands and drops trailing .00", () => {
    const text = formatRecordNotice(expense({ amount: 12000, description: null }));
    expect(text).toContain("<b>12,000 TWD</b>");
  });

  it("echoes @username only when the sender typed it", () => {
    const typed = formatRecordNotice(
      expense({ payers: [{ user: { ...alice, typedAt: true }, amount: 500 }] }),
    );
    expect(typed.split("\n")[0]).toContain("@alice 付了");
    expect(typed.split("\n")[0]).not.toContain("tg://user?id=111");
  });

  it("falls back to a plain name for users without a Telegram id", () => {
    const text = formatRecordNotice(expense({ payers: [{ user: dave, amount: 500 }] }));
    expect(text.split("\n")[0]).toBe("Dave 付了 <b>500 TWD</b>（晚餐）");
  });

  it("escapes HTML in descriptions and names", () => {
    const text = formatRecordNotice(
      expense({
        description: "<b>bold</b> & co",
        payers: [{ user: { ...dave, firstName: "<script>" }, amount: 500 }],
      }),
    );
    expect(text).toContain("（&lt;b&gt;bold&lt;/b&gt; &amp; co）");
    expect(text).toContain("&lt;script&gt; 付了");
  });
});

describe("formatRecordNotice — settlement", () => {
  const settlement: NoticeRecord = {
    type: "settlement",
    amount: 1200,
    currency: "TWD",
    description: null,
    payers: [{ user: alice, amount: 1200 }],
    splits: [{ user: bob, amount: 1200 }],
  };

  it("renders from → to with the amount", () => {
    expect(formatRecordNotice(settlement)).toBe(
      '💸 <a href="tg://user?id=111">Alice</a> → <a href="tg://user?id=222">Bob</a>　<b>1,200 TWD</b>',
    );
  });

  it("never shows a split line", () => {
    expect(formatRecordNotice(settlement)).not.toContain("\n");
  });
});

describe("formatRecordNotice — deleted", () => {
  it("strikes the original text through and appends a marker", () => {
    const live = formatRecordNotice(expense());
    const dead = formatRecordNotice(expense(), { deleted: true });
    expect(dead).toBe(`<s>${live}</s>\n\n🗑️ 已刪除`);
  });

  it("applies to settlements too", () => {
    const dead = formatRecordNotice(
      {
        type: "settlement",
        amount: 50,
        currency: "JPY",
        description: null,
        payers: [{ user: alice, amount: 50 }],
        splits: [{ user: bob, amount: 50 }],
      },
      { deleted: true },
    );
    expect(dead.startsWith("<s>💸 ")).toBe(true);
    expect(dead.endsWith("</s>\n\n🗑️ 已刪除")).toBe(true);
  });
});

describe("formatRecordNotice — degenerate records", () => {
  it("survives an expense with no splits", () => {
    const text = formatRecordNotice(expense({ splits: [] }));
    expect(text).toBe('<a href="tg://user?id=111">Alice</a> 付了 <b>500 TWD</b>（晚餐）');
  });

  it("survives a settlement missing a side", () => {
    const text = formatRecordNotice({
      type: "settlement",
      amount: 50,
      currency: "TWD",
      description: null,
      payers: [],
      splits: [],
    });
    expect(text).toBe("💸 轉帳　<b>50 TWD</b>");
  });
});
