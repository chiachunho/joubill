import { describe, expect, it } from "vitest";

import { formatPushNotice, recordPushUrl, type PushNoticeInput } from "@/lib/push-notice";
import { pushRecipients } from "@/lib/push-plan";
import type { RecordSnapshot } from "@/lib/record-audit";

const person = (userId: number, firstName: string) => ({
  userId,
  displayName: null,
  firstName,
  lastName: null,
  username: null,
  telegramId: null,
});
const ming = person(1, "小明");
const hua = person(2, "阿花");
const wei = person(3, "阿偉");
const outsider = person(4, "路人");

function expense(over: Partial<RecordSnapshot> = {}): RecordSnapshot {
  return {
    type: "expense",
    amount: 12000,
    currency: "JPY",
    description: "燒肉晚餐",
    spentAt: "2026-10-30",
    fxRate: null,
    fxQuote: null,
    receipts: 0,
    payers: [{ user: ming, amount: 12000 }],
    splits: [
      { user: ming, amount: 4000 },
      { user: hua, amount: 4000 },
      { user: wei, amount: 4000 },
    ],
    ...over,
  };
}

function settlement(over: Partial<RecordSnapshot> = {}): RecordSnapshot {
  return expense({
    type: "settlement",
    amount: 4500,
    currency: "TWD",
    description: null,
    payers: [{ user: ming, amount: 4500 }],
    splits: [{ user: hua, amount: 4500 }],
    ...over,
  });
}

describe("pushRecipients", () => {
  it("notifies everyone on a new record except whoever recorded it", () => {
    expect(
      pushRecipients({
        action: "created",
        before: null,
        after: expense(),
        creatorId: 1,
        actorId: 1,
      }),
    ).toEqual([2, 3]);
  });

  it("does not notify a creator who isn't on a new record", () => {
    const after = expense({
      payers: [{ user: hua, amount: 12000 }],
      splits: [{ user: hua, amount: 12000 }],
    });
    expect(
      pushRecipients({ action: "created", before: null, after, creatorId: 4, actorId: 4 }),
    ).toEqual([2]);
  });

  it("notifies people taken off a record as well as people added", () => {
    const before = expense();
    const after = expense({
      splits: [
        { user: ming, amount: 6000 },
        { user: outsider, amount: 6000 },
      ],
    });
    expect(pushRecipients({ action: "updated", before, after, creatorId: 1, actorId: 1 })).toEqual([
      2, 3, 4,
    ]);
  });

  it("tells the creator when someone else edits or deletes their record", () => {
    const before = expense({
      payers: [{ user: hua, amount: 12000 }],
      splits: [{ user: hua, amount: 12000 }],
    });
    expect(
      pushRecipients({ action: "deleted", before, after: null, creatorId: 4, actorId: 2 }),
    ).toEqual([4]);
    expect(
      pushRecipients({ action: "updated", before, after: before, creatorId: 4, actorId: 2 }),
    ).toEqual([4]);
  });

  it("never notifies the actor, even as creator", () => {
    expect(
      pushRecipients({
        action: "deleted",
        before: expense(),
        after: null,
        creatorId: 2,
        actorId: 2,
      }),
    ).toEqual([1, 3]);
  });
});

function input(over: Partial<PushNoticeInput>): PushNoticeInput {
  return {
    action: "created",
    groupId: 12,
    groupTitle: "東京五日遊",
    recordId: 99,
    before: null,
    after: expense(),
    actor: ming,
    creatorId: 1,
    recipientId: 2,
    ...over,
  };
}

describe("formatPushNotice", () => {
  it("tells a new expense's debtor their share", () => {
    expect(formatPushNotice(input({}))).toEqual({
      title: "東京五日遊",
      body: "小明 記了「燒肉晚餐」12,000 JPY，你分 4,000 JPY",
      url: "/app/groups/12/expenses/99/edit?via=push",
      tag: "r99",
    });
  });

  it("tells a payer who isn't splitting what they were recorded as paying", () => {
    const after = expense({
      payers: [{ user: hua, amount: 12000 }],
      splits: [{ user: ming, amount: 12000 }],
    });
    expect(formatPushNotice(input({ after }))?.body).toBe(
      "小明 記了「燒肉晚餐」12,000 JPY，記你付了 12,000 JPY",
    );
  });

  it("names an expense with no description by its amount", () => {
    expect(formatPushNotice(input({ after: expense({ description: null }) }))?.body).toBe(
      "小明 記了一筆 12,000 JPY，你分 4,000 JPY",
    );
  });

  it("reads a repayment from the receiver's side", () => {
    const n = formatPushNotice(input({ after: settlement() }));
    expect(n?.body).toBe("小明 還你 4,500 TWD");
    expect(n?.url).toBe("/app/groups/12/settlements/99?via=push");
  });

  it("says who recorded a repayment they didn't send", () => {
    expect(formatPushNotice(input({ after: settlement(), actor: wei }))?.body).toBe(
      "阿偉 記了：小明 還你 4,500 TWD",
    );
  });

  it("states the first change of an edit and counts the rest", () => {
    const before = expense({
      amount: 1200,
      currency: "TWD",
      description: "電費",
      payers: [{ user: hua, amount: 1200 }],
      splits: [
        { user: hua, amount: 600 },
        { user: ming, amount: 600 },
      ],
    });
    const after = {
      ...before,
      amount: 1450,
      payers: [{ user: hua, amount: 1450 }],
      splits: [
        { user: hua, amount: 725 },
        { user: ming, amount: 725 },
      ],
    };
    expect(
      formatPushNotice(
        input({ action: "updated", before, after, actor: ming, creatorId: 2, recipientId: 2 }),
      )?.body,
    ).toBe("小明 修改了你記的「電費」：金額 1,200 → 1,450");

    const more = { ...after, description: "電費（十月）" };
    expect(
      formatPushNotice(
        input({
          action: "updated",
          before,
          after: more,
          actor: ming,
          creatorId: 2,
          recipientId: 2,
        }),
      )?.body,
    ).toBe("小明 修改了你記的「電費（十月）」：金額 1,200 → 1,450 等 2 項");
  });

  it("opens a deleted record's history", () => {
    const n = formatPushNotice(
      input({ action: "deleted", before: expense(), after: null, actor: hua, recipientId: 1 }),
    );
    expect(n?.body).toBe("阿花 刪除了你記的「燒肉晚餐」12,000 JPY（你分 4,000 JPY）");
    expect(n?.url).toBe("/app/groups/12/activity?record=99&via=push");
  });

  it("returns null without the snapshot an action needs", () => {
    expect(formatPushNotice(input({ action: "updated", before: null }))).toBeNull();
  });
});

describe("recordPushUrl", () => {
  it("points each kind at its page", () => {
    expect(recordPushUrl("created", "expense", 1, 2)).toBe(
      "/app/groups/1/expenses/2/edit?via=push",
    );
    expect(recordPushUrl("updated", "settlement", 1, 2)).toBe(
      "/app/groups/1/settlements/2?via=push",
    );
    expect(recordPushUrl("deleted", "settlement", 1, 2)).toBe(
      "/app/groups/1/activity?record=2&via=push",
    );
  });
});
