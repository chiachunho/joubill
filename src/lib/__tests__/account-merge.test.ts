import { describe, expect, it } from "vitest";

import {
  mergedProfileFields,
  planBeancountConfigs,
  planMembership,
  suggestKeep,
  validateAccountMerge,
  type MergeAccount,
  type MergeProfile,
} from "../account-merge";
import { planMerge, type MergeSplitRow } from "../member-merge";

const account = (over: Partial<MergeAccount> & { id: number }): MergeAccount => ({
  telegramId: null,
  placeholderGroupId: null,
  identities: [],
  ...over,
});

describe("validateAccountMerge", () => {
  it("accepts a Google-only account and a Telegram account", () => {
    expect(
      validateAccountMerge(
        account({ id: 1, identities: [{ provider: "google", providerUid: "g1" }] }),
        account({
          id: 2,
          telegramId: 99,
          identities: [{ provider: "telegram", providerUid: "99" }],
        }),
      ),
    ).toEqual({ ok: true });
  });

  it("refuses a missing account or the same account twice", () => {
    expect(validateAccountMerge(account({ id: 1 }), undefined).ok).toBe(false);
    expect(validateAccountMerge(account({ id: 1 }), account({ id: 1 })).ok).toBe(false);
  });

  it("refuses a placeholder on either side", () => {
    expect(
      validateAccountMerge(account({ id: 1 }), account({ id: 2, placeholderGroupId: 5 })).ok,
    ).toBe(false);
    expect(
      validateAccountMerge(account({ id: 1, placeholderGroupId: 5 }), account({ id: 2 })).ok,
    ).toBe(false);
  });

  it("refuses two different Telegram ids, which can't share one row", () => {
    const r = validateAccountMerge(
      account({ id: 1, telegramId: 10 }),
      account({ id: 2, telegramId: 11 }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("Telegram");
  });

  it("accepts the same Telegram id on one side only", () => {
    expect(validateAccountMerge(account({ id: 1, telegramId: 10 }), account({ id: 2 })).ok).toBe(
      true,
    );
  });

  it("refuses two different accounts of the same provider and names it", () => {
    const r = validateAccountMerge(
      account({ id: 1, identities: [{ provider: "google", providerUid: "a" }] }),
      account({ id: 2, identities: [{ provider: "google", providerUid: "b" }] }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("Google");
  });
});

describe("suggestKeep", () => {
  const old = new Date("2025-01-01");
  const recent = new Date("2026-10-01");

  it("prefers the account holding the Telegram id, even with fewer records", () => {
    expect(
      suggestKeep(
        { id: 1, telegramId: null, recordCount: 50, createdAt: old },
        { id: 2, telegramId: 7, recordCount: 1, createdAt: recent },
      ),
    ).toBe(2);
  });

  it("then the one with more records", () => {
    expect(
      suggestKeep(
        { id: 1, telegramId: null, recordCount: 3, createdAt: old },
        { id: 2, telegramId: null, recordCount: 9, createdAt: recent },
      ),
    ).toBe(2);
  });

  it("then the older one", () => {
    expect(
      suggestKeep(
        { id: 1, telegramId: null, recordCount: 0, createdAt: recent },
        { id: 2, telegramId: null, recordCount: 0, createdAt: old },
      ),
    ).toBe(2);
  });
});

describe("mergedProfileFields", () => {
  const empty: MergeProfile = {
    telegramId: null,
    email: null,
    avatarUrl: null,
    username: null,
    lastName: null,
    languageCode: null,
  };

  it("fills only what the kept account lacks", () => {
    expect(
      mergedProfileFields(
        { ...empty, email: "keep@example.com" },
        { ...empty, telegramId: 42, email: "other@example.com", avatarUrl: "https://x/p.jpg" },
      ),
    ).toEqual({ telegramId: 42, avatarUrl: "https://x/p.jpg" });
  });

  it("changes nothing when the kept account has it all", () => {
    expect(
      mergedProfileFields(
        {
          telegramId: 1,
          email: "a",
          avatarUrl: "b",
          username: "c",
          lastName: "d",
          languageCode: "zh",
        },
        {
          telegramId: null,
          email: "x",
          avatarUrl: "y",
          username: "z",
          lastName: "w",
          languageCode: "en",
        },
      ),
    ).toEqual({});
  });
});

describe("planMembership", () => {
  it("repoints groups only the absorbed account is in", () => {
    expect(
      planMembership([{ groupId: 1, status: "active" }], [{ groupId: 2, status: "inactive" }]),
    ).toEqual({ repoint: [2], activate: [], drop: [] });
  });

  it("keeps one row in a shared group, active if either was", () => {
    expect(
      planMembership(
        [
          { groupId: 1, status: "inactive" },
          { groupId: 2, status: "active" },
          { groupId: 3, status: "inactive" },
        ],
        [
          { groupId: 1, status: "active" },
          { groupId: 2, status: "inactive" },
          { groupId: 3, status: "inactive" },
        ],
      ),
    ).toEqual({ repoint: [], activate: [1], drop: [1, 2, 3] });
  });
});

describe("planBeancountConfigs", () => {
  it("moves the absorbed config unless the kept account has one in that group", () => {
    expect(
      planBeancountConfigs(
        [{ id: 10, groupId: 1 }],
        [
          { id: 20, groupId: 1 },
          { id: 21, groupId: 2 },
        ],
      ),
    ).toEqual({ repoint: [21], drop: [20] });
  });
});

describe("two real accounts on the same expense", () => {
  // Mei (1, Google) and 小美 (2, Telegram) both paid into and owe on expense 100.
  const split = (id: number, debtorId: number, amount: number): MergeSplitRow => ({
    id,
    expenseId: 100,
    debtorId,
    amount,
    shareType: "equal",
    splitValue: null,
  });
  const payers = [
    { id: 1, expenseId: 100, payerId: 1, amount: 200 },
    { id: 2, expenseId: 100, payerId: 2, amount: 100 },
  ];
  const splits = [split(11, 1, 100), split(12, 2, 100), split(13, 3, 100)];

  it("sums payers and splits into the kept account, so totals don't move", () => {
    const plan = planMerge({ fromId: 1, toId: 2, payers, splits });
    expect(plan.payerMerge).toEqual([{ keepId: 2, deleteId: 1, amount: 300 }]);
    expect(plan.splitDelete).toEqual([11]);
    const merged = plan.splitUpdates.find((u) => u.id === 12);
    expect(merged).toMatchObject({ amount: 200, shareType: "shares", splitValue: 2 });
    // The third person becomes weight 1 so the form still reads the expense as uniform.
    expect(plan.splitUpdates.find((u) => u.id === 13)).toMatchObject({
      shareType: "shares",
      splitValue: 1,
    });
    expect(plan.recordIds).toEqual([100]);
  });
});
