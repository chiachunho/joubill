import { describe, expect, it } from "vitest";

import type { Profile } from "@/lib/label";
import { beancountAccountName, recordToBeancount, type BeancountRecord } from "@/lib/beancount";

const ALICE = 1;
const BOB = 2;
const CAROL = 3;

const people = new Map<number, Profile>([
  [
    ALICE,
    { userId: ALICE, displayName: null, firstName: "Alice", lastName: null, username: "alice" },
  ],
  [BOB, { userId: BOB, displayName: null, firstName: "Bob", lastName: null, username: "bob" }],
  [
    CAROL,
    { userId: CAROL, displayName: null, firstName: "Carol", lastName: null, username: "carol" },
  ],
]);

const SPENT_AT = "2026-06-30T08:00:00.000Z";

/** Parse `  Account  123.45 CUR [@ rate quote]` posting lines into {account, amount}. */
function postings(text: string): { account: string; amount: number }[] {
  return text
    .split("\n")
    .filter((l) => l.startsWith("  "))
    .map((l) => {
      const m = l.trim().match(/^(\S+)\s+(-?\d+\.\d{2})\s/);
      if (!m) throw new Error(`unparseable posting: ${l}`);
      return { account: m[1], amount: Number(m[2]) };
    });
}

function sum(text: string): number {
  return Math.round(postings(text).reduce((s, p) => s + p.amount, 0) * 100) / 100;
}

function expense(over: Partial<BeancountRecord>): BeancountRecord {
  return {
    type: "expense",
    amount: 300,
    currency: "TWD",
    description: "晚餐",
    spentAt: SPENT_AT,
    payers: [{ userId: ALICE, amount: 300 }],
    splits: [
      { userId: ALICE, amount: 100 },
      { userId: BOB, amount: 100 },
      { userId: CAROL, amount: 100 },
    ],
    ...over,
  };
}

describe("recordToBeancount — expense, personal perspective", () => {
  it("single payer = U, equal split (matches the chosen example)", () => {
    const out = recordToBeancount(expense({}), ALICE, people);
    expect(out).toBe(
      [
        '2026-06-30 * "晚餐"',
        "  Expenses:Uncategorized    100.00 TWD",
        "  Assets:Cash              -300.00 TWD",
        "  Assets:Receivable:Bob     100.00 TWD",
        "  Assets:Receivable:Carol   100.00 TWD",
      ].join("\n"),
    );
    expect(sum(out)).toBe(0);
  });

  it("U is not a payer: no Cash leg, single payable to the payer", () => {
    const out = recordToBeancount(
      expense({ payers: [{ userId: BOB, amount: 300 }] }),
      ALICE,
      people,
    );
    const ps = postings(out);
    expect(ps).toContainEqual({ account: "Expenses:Uncategorized", amount: 100 });
    expect(ps).toContainEqual({ account: "Assets:Receivable:Bob", amount: -100 });
    // U paid nothing → no Assets:Cash posting, and Carol's debt to Bob is NOT in U's ledger.
    expect(ps.find((p) => p.account === "Assets:Cash")).toBeUndefined();
    expect(ps.find((p) => p.account === "Assets:Receivable:Carol")).toBeUndefined();
    expect(sum(out)).toBe(0);
  });

  it("multi-payer split allocates proportionally and stays balanced", () => {
    // Alice paid 200, Bob paid 100; equal 100 share each.
    const out = recordToBeancount(
      expense({
        payers: [
          { userId: ALICE, amount: 200 },
          { userId: BOB, amount: 100 },
        ],
      }),
      ALICE,
      people,
    );
    const ps = postings(out);
    // netAlice = 200 - 100 = +100; only Carol is a net debtor (net -100) → owes Alice 100.
    expect(ps).toContainEqual({ account: "Expenses:Uncategorized", amount: 100 });
    expect(ps).toContainEqual({ account: "Assets:Cash", amount: -200 });
    expect(ps).toContainEqual({ account: "Assets:Receivable:Carol", amount: 100 });
    expect(sum(out)).toBe(0);
  });

  it("U is unrelated to the expense: no legs, annotated with a comment", () => {
    const out = recordToBeancount(
      expense({
        payers: [{ userId: BOB, amount: 300 }],
        splits: [
          { userId: BOB, amount: 150 },
          { userId: CAROL, amount: 150 },
        ],
      }),
      ALICE,
      people,
    );
    expect(postings(out)).toHaveLength(0);
    expect(out).toContain("; 你與這筆支出無關");
  });

  it("rounding residual lands on a receivable, leaving Cash exact", () => {
    // Alice pays 10, Bob pays 5; 4-way equal split = 3.75 each. Alice's net
    // (6.25) spreads over two net debtors → 3.13 + 3.13 = 6.26, a +0.01 residual.
    const out = recordToBeancount(
      expense({
        amount: 15,
        payers: [
          { userId: ALICE, amount: 10 },
          { userId: BOB, amount: 5 },
        ],
        splits: [
          { userId: ALICE, amount: 3.75 },
          { userId: BOB, amount: 3.75 },
          { userId: CAROL, amount: 3.75 },
          { userId: 4, amount: 3.75 },
        ],
      }),
      ALICE,
      new Map([
        ...people,
        [4, { userId: 4, displayName: null, firstName: "Dave", lastName: null, username: "dave" }],
      ]),
    );
    const ps = postings(out);
    // Cash must stay exactly -10.00 (the real amount fronted); the cent residual
    // is absorbed by a receivable leg, not the factual Cash/Expenses figures.
    expect(ps).toContainEqual({ account: "Assets:Cash", amount: -10 });
    expect(ps).toContainEqual({ account: "Expenses:Uncategorized", amount: 3.75 });
    expect(sum(out)).toBe(0);
  });

  it("rounding residual is folded back so postings sum to zero", () => {
    // 100 split 3 ways = 33.34/33.33/33.33; Alice sole payer.
    const out = recordToBeancount(
      expense({
        amount: 100,
        payers: [{ userId: ALICE, amount: 100 }],
        splits: [
          { userId: ALICE, amount: 33.34 },
          { userId: BOB, amount: 33.33 },
          { userId: CAROL, amount: 33.33 },
        ],
      }),
      ALICE,
      people,
    );
    expect(sum(out)).toBe(0);
  });
});

describe("recordToBeancount — settlement", () => {
  const settlement = (over: Partial<BeancountRecord> = {}): BeancountRecord => ({
    type: "settlement",
    amount: 150,
    currency: "TWD",
    description: null,
    spentAt: SPENT_AT,
    payers: [{ userId: ALICE, amount: 150 }], // from
    splits: [{ userId: BOB, amount: 150 }], // to
    ...over,
  });

  it("U = from (the one repaying): cash out, receivable from the receiver up", () => {
    const ps = postings(recordToBeancount(settlement(), ALICE, people));
    expect(ps).toContainEqual({ account: "Assets:Receivable:Bob", amount: 150 });
    expect(ps).toContainEqual({ account: "Assets:Cash", amount: -150 });
    // settlements never produce an Expenses leg
    expect(ps.find((p) => p.account === "Expenses:Uncategorized")).toBeUndefined();
  });

  it("U = to (the receiver): cash in, the payer's debt reduced", () => {
    const ps = postings(recordToBeancount(settlement(), BOB, people));
    expect(ps).toContainEqual({ account: "Assets:Cash", amount: 150 });
    expect(ps).toContainEqual({ account: "Assets:Receivable:Alice", amount: -150 });
    expect(ps.find((p) => p.account === "Expenses:Uncategorized")).toBeUndefined();
  });

  it("U not involved: neutral, annotated with a comment", () => {
    const out = recordToBeancount(settlement(), CAROL, people);
    expect(out).toContain("; 你未參與這筆還款");
    expect(sum(out)).toBe(0);
  });
});

describe("recordToBeancount — FX", () => {
  it("annotates every posting with @ rate quote and balances in both currencies", () => {
    const out = recordToBeancount(
      expense({
        currency: "JPY",
        amount: 3000,
        payers: [{ userId: ALICE, amount: 3000 }],
        splits: [
          { userId: ALICE, amount: 1000 },
          { userId: BOB, amount: 1000 },
          { userId: CAROL, amount: 1000 },
        ],
      }),
      ALICE,
      people,
      { quote: "TWD", rate: 0.21 },
    );
    const priceLines = out.split("\n").filter((l) => l.startsWith("  "));
    expect(priceLines.every((l) => l.includes("@ 0.21 TWD"))).toBe(true);
    // balances in JPY (units) and in TWD (units * rate)
    const ps = postings(out);
    expect(Math.round(ps.reduce((s, p) => s + p.amount, 0) * 100) / 100).toBe(0);
    expect(Math.round(ps.reduce((s, p) => s + p.amount * 0.21, 0) * 100) / 100).toBe(0);
  });

  it("no price when quote === currency", () => {
    const out = recordToBeancount(expense({}), ALICE, people, { quote: "TWD", rate: 1 });
    expect(out).not.toContain("@");
  });

  it("emits a comment when the rate is unavailable", () => {
    const out = recordToBeancount(expense({ currency: "JPY" }), ALICE, people, {
      quote: "TWD",
      rate: null,
    });
    expect(out).toContain("; 匯率不可得（JPY→TWD）");
    expect(out).not.toContain("@");
  });
});

describe("recordToBeancount — custom accounts", () => {
  const accounts = {
    expenses: "Expenses:Food",
    cash: "Assets:Bank:Checking",
    receivablePrefix: "Assets:Owed",
    personAccounts: { [String(BOB)]: "Robert" },
  };

  it("uses the configured accounts and per-person leaf, falling back to auto name", () => {
    const out = recordToBeancount(expense({}), ALICE, people, undefined, accounts);
    const ps = postings(out);
    expect(ps).toContainEqual({ account: "Expenses:Food", amount: 100 });
    expect(ps).toContainEqual({ account: "Assets:Bank:Checking", amount: -300 });
    // Bob has a configured leaf; Carol falls back to her auto-derived name.
    expect(ps).toContainEqual({ account: "Assets:Owed:Robert", amount: 100 });
    expect(ps).toContainEqual({ account: "Assets:Owed:Carol", amount: 100 });
    expect(sum(out)).toBe(0);
  });

  it("a blank configured leaf falls back to the auto name (no trailing colon)", () => {
    const out = recordToBeancount(expense({}), ALICE, people, undefined, {
      ...accounts,
      personAccounts: { [String(BOB)]: "" },
    });
    const ps = postings(out);
    expect(ps).toContainEqual({ account: "Assets:Owed:Bob", amount: 100 });
    expect(out).not.toContain("Assets:Owed: ");
  });

  it("residual still lands on a receivable leg under a custom prefix, keeping Cash exact", () => {
    const out = recordToBeancount(
      expense({
        amount: 15,
        payers: [
          { userId: ALICE, amount: 10 },
          { userId: BOB, amount: 5 },
        ],
        splits: [
          { userId: ALICE, amount: 3.75 },
          { userId: BOB, amount: 3.75 },
          { userId: CAROL, amount: 3.75 },
          { userId: 4, amount: 3.75 },
        ],
      }),
      ALICE,
      new Map([
        ...people,
        [4, { userId: 4, displayName: null, firstName: "Dave", lastName: null, username: "dave" }],
      ]),
      undefined,
      accounts,
    );
    const ps = postings(out);
    // The kind tag (not the "Assets:Receivable" string) drives residual folding.
    expect(ps).toContainEqual({ account: "Assets:Bank:Checking", amount: -10 });
    expect(sum(out)).toBe(0);
  });
});

describe("beancountAccountName", () => {
  it("prefers a capitalized username", () => {
    expect(
      beancountAccountName({
        userId: 1,
        displayName: null,
        firstName: "x",
        lastName: null,
        username: "alice",
      }),
    ).toBe("Alice");
  });

  it("falls back to the sanitized name", () => {
    expect(
      beancountAccountName({
        userId: 1,
        displayName: null,
        firstName: "John",
        lastName: "Doe",
        username: null,
      }),
    ).toBe("JohnDoe");
  });

  it("falls back to User<id> for a non-ASCII-only name", () => {
    expect(
      beancountAccountName({
        userId: 7,
        displayName: null,
        firstName: "陳",
        lastName: "小明",
        username: null,
      }),
    ).toBe("User7");
  });
});
