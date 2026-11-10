import { describe, expect, it } from "vitest";

import {
  defaultEventAccount,
  eventAccountLeaf,
  groupToBeancount,
  recordToBeancount,
  resolveBeancountAccounts,
  type BeancountAccounts,
  type BeancountRecord,
} from "@/lib/beancount";
import { beancountRangeParams, parseBeancountRange } from "@/lib/beancount-range";

const U = 1;
const BOB = 2;
const CAROL = 3;

const ACCOUNTS: BeancountAccounts = {
  expenses: "Expenses:Food",
  cash: "Assets:Cash",
  event: "Assets:Receivable:Trip",
};

const SPENT_AT = "2026-06-30T08:00:00.000Z";

/** Posting lines (`  Account  123.45 CUR [@ rate quote]`) as {account, amount}; metadata is skipped. */
function postings(text: string): { account: string; amount: number }[] {
  return text
    .split("\n")
    .map((l) => /^ {2}(\S+)\s+(-?\d+\.\d{2}) /.exec(l))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ account: m[1], amount: Number(m[2]) }));
}

function sum(text: string): number {
  return Math.round(postings(text).reduce((s, p) => s + p.amount, 0) * 100) / 100 + 0;
}

function expense(over: Partial<BeancountRecord> = {}): BeancountRecord {
  return {
    id: 42,
    type: "expense",
    amount: 300,
    currency: "TWD",
    description: "晚餐",
    spentAt: SPENT_AT,
    payers: [{ userId: U, amount: 300 }],
    splits: [
      { userId: U, amount: 100 },
      { userId: BOB, amount: 100 },
      { userId: CAROL, amount: 100 },
    ],
    ...over,
  };
}

function settlement(from: number, to: number, amount = 50): BeancountRecord {
  return {
    id: 7,
    type: "settlement",
    amount,
    currency: "TWD",
    description: null,
    spentAt: SPENT_AT,
    payers: [{ userId: from, amount }],
    splits: [{ userId: to, amount }],
  };
}

function render(record: BeancountRecord, fx?: { quote: string; rate: number }) {
  const out = recordToBeancount(record, U, ACCOUNTS, fx);
  if (out === null) throw new Error("expected a transaction");
  return out;
}

describe("recordToBeancount: expenses", () => {
  it("puts what the others owe U into the event account when U paid", () => {
    const out = render(expense());
    expect(postings(out)).toEqual([
      { account: "Expenses:Food", amount: 100 },
      { account: "Assets:Cash", amount: -300 },
      { account: "Assets:Receivable:Trip", amount: 200 },
    ]);
    expect(sum(out)).toBe(0);
  });

  it("records U's share against the event account when someone else paid", () => {
    const out = render(expense({ payers: [{ userId: BOB, amount: 300 }] }));
    expect(postings(out)).toEqual([
      { account: "Expenses:Food", amount: 100 },
      { account: "Assets:Receivable:Trip", amount: -100 },
    ]);
  });

  it("nets several payers into one event leg", () => {
    const out = render(
      expense({
        payers: [
          { userId: U, amount: 200 },
          { userId: BOB, amount: 100 },
        ],
      }),
    );
    expect(postings(out)).toEqual([
      { account: "Expenses:Food", amount: 100 },
      { account: "Assets:Cash", amount: -200 },
      { account: "Assets:Receivable:Trip", amount: 100 },
    ]);
  });

  it("balances exactly when a split doesn't divide evenly", () => {
    const out = render(
      expense({
        amount: 1000,
        payers: [{ userId: U, amount: 1000 }],
        splits: [
          { userId: U, amount: 333.33 },
          { userId: BOB, amount: 333.33 },
          { userId: CAROL, amount: 333.34 },
        ],
      }),
    );
    expect(postings(out)).toContainEqual({ account: "Assets:Receivable:Trip", amount: 666.67 });
    expect(sum(out)).toBe(0);
  });

  it("leaves out the event leg when U paid exactly their own share", () => {
    const out = render(
      expense({
        amount: 100,
        payers: [{ userId: U, amount: 100 }],
        splits: [{ userId: U, amount: 100 }],
      }),
    );
    expect(postings(out).map((p) => p.account)).toEqual(["Expenses:Food", "Assets:Cash"]);
  });

  it("skips an expense U neither paid for nor shares", () => {
    const out = recordToBeancount(
      expense({
        payers: [{ userId: BOB, amount: 300 }],
        splits: [{ userId: CAROL, amount: 300 }],
      }),
      U,
      ACCOUNTS,
    );
    expect(out).toBeNull();
  });
});

describe("recordToBeancount: settlements", () => {
  it("moves cash out and the event account up when U repays", () => {
    expect(postings(render(settlement(U, BOB)))).toEqual([
      { account: "Assets:Receivable:Trip", amount: 50 },
      { account: "Assets:Cash", amount: -50 },
    ]);
  });

  it("moves cash in and the event account down when U is repaid", () => {
    expect(postings(render(settlement(BOB, U)))).toEqual([
      { account: "Assets:Cash", amount: 50 },
      { account: "Assets:Receivable:Trip", amount: -50 },
    ]);
  });

  it("skips a settlement between two other people", () => {
    expect(recordToBeancount(settlement(BOB, CAROL), U, ACCOUNTS)).toBeNull();
  });

  it("skips a settlement from U to U (left behind by an account merge)", () => {
    expect(recordToBeancount(settlement(U, U), U, ACCOUNTS)).toBeNull();
  });
});

describe("recordToBeancount: formatting", () => {
  it("writes the header, the joubill_id and escaped narration", () => {
    const out = render(expense({ description: 'Say "hi"\nnow' }));
    const [header, meta] = out.split("\n");
    expect(header).toBe('2026-06-30 * "Say \\"hi\\" now"');
    expect(meta).toBe('  joubill_id: "42"');
  });

  it("uses the narration override", () => {
    const out = recordToBeancount(settlement(BOB, U), U, ACCOUNTS, null, "還款 Bob → 我");
    expect(out?.split("\n")[0]).toBe('2026-06-30 * "還款 Bob → 我"');
  });

  it("prices every posting in the group currency for a foreign record", () => {
    const out = render(expense({ currency: "JPY" }), { quote: "TWD", rate: 0.2135 });
    const legs = out.split("\n").filter((l) => /\d\.\d{2} /.test(l));
    expect(legs).toHaveLength(3);
    for (const l of legs) expect(l).toMatch(/ JPY @ 0\.2135 TWD$/);
  });

  it("adds no price when the record is already in the group currency", () => {
    expect(render(expense(), { quote: "TWD", rate: 1 })).not.toContain("@");
  });
});

describe("event account defaults", () => {
  it("keeps letters and digits of any script from the group title", () => {
    expect(eventAccountLeaf("日本 旅行!", 5)).toBe("日本旅行");
    expect(eventAccountLeaf("japan trip 2026", 5)).toBe("Japantrip2026");
  });

  it("falls back to the group id when nothing usable is left", () => {
    expect(eventAccountLeaf("🎉🎉", 5)).toBe("Group5");
    expect(defaultEventAccount("", 9)).toBe("Assets:Receivable:Group9");
  });

  it("fills every unsaved account with its default", () => {
    expect(resolveBeancountAccounts(null, { id: 1, title: "Tokyo" })).toEqual({
      expenses: "Expenses:Uncategorized",
      cash: "Assets:Cash",
      event: "Assets:Receivable:Tokyo",
    });
    expect(
      resolveBeancountAccounts(
        { expensesAccount: "Expenses:Travel", cashAccount: "Assets:Bank", eventAccount: null },
        { id: 1, title: "Tokyo" },
      ),
    ).toEqual({
      expenses: "Expenses:Travel",
      cash: "Assets:Bank",
      event: "Assets:Receivable:Tokyo",
    });
  });
});

describe("groupToBeancount", () => {
  const records = [
    { record: expense({ id: 1 }), rate: 1 },
    { record: expense({ id: 2, payers: [{ userId: BOB, amount: 300 }] }), rate: 1 },
    { record: { ...settlement(BOB, U, 100), id: 3 }, rate: 1 },
    { record: { ...settlement(BOB, CAROL), id: 4 }, rate: 1 },
  ];
  const base = {
    groupTitle: "Trip",
    defaultCurrency: "TWD",
    userId: U,
    accounts: ACCOUNTS,
    records,
    now: new Date("2026-11-01T14:30:00Z"),
  };

  it("counts what it wrote and what it skipped", () => {
    const out = groupToBeancount({ ...base, range: { kind: "all" } });
    expect(out.included).toBe(3);
    expect(out.skipped).toBe(1);
    expect(out.text).toContain("; 3 筆，略過 1 筆跟你無關的紀錄");
    expect(out.text.match(/joubill_id/g)).toHaveLength(3);
  });

  it("leaves the event account at U's net balance", () => {
    const { text } = groupToBeancount({ ...base, range: { kind: "all" } });
    const event = postings(text)
      .filter((p) => p.account === ACCOUNTS.event)
      .reduce((s, p) => s + p.amount, 0);
    // +200 (U paid for the others) −100 (U's share of Bob's) −100 (Bob repaid U)
    expect(event).toBe(0);
    expect(sum(text)).toBe(0);
  });

  it("opens the event account only when the file starts the ledger", () => {
    const open = `2026-06-30 open ${ACCOUNTS.event}`;
    const lines = (range: Parameters<typeof groupToBeancount>[0]["range"]) =>
      groupToBeancount({ ...base, range }).text.split("\n");

    expect(lines({ kind: "all" })).toContain(open);
    expect(lines({ kind: "new", since: null })).toContain(open);
    expect(lines({ kind: "new", since: new Date("2026-06-01T00:00:00Z") })).toContain(`; ${open}`);
    expect(lines({ kind: "custom", from: "2026-06-01", to: "2026-07-01" })).toContain(`; ${open}`);
    // Expenses and Cash are almost always opened already in the user's own ledger.
    expect(lines({ kind: "all" })).toContain(`; 2026-06-30 open ${ACCOUNTS.cash}`);
  });

  it("converts at each record's own rate", () => {
    const { text } = groupToBeancount({
      ...base,
      range: { kind: "all" },
      records: [{ record: expense({ currency: "JPY" }), rate: 0.2 }],
    });
    expect(text).toContain("JPY @ 0.2 TWD");
  });
});

describe("beancount export range", () => {
  it("round-trips every kind through the query string", () => {
    const from = "2026-10-01";
    const to = "2026-10-31";
    for (const range of [{ kind: "new" }, { kind: "all" }, { kind: "custom", from, to }] as const) {
      const qs = new URLSearchParams(beancountRangeParams(range));
      expect(parseBeancountRange(qs)).toEqual(range);
    }
  });

  it("reads a JSON body too", () => {
    expect(parseBeancountRange({ range: "all" })).toEqual({ kind: "all" });
  });

  it("refuses an unknown kind, an instant, an impossible day and a reversed range", () => {
    const parse = (o: Record<string, string>) => "error" in parseBeancountRange(o);
    expect(parse({})).toBe(true);
    expect(parse({ range: "6m" })).toBe(true);
    expect(parse({ range: "custom", from: "2026-10-01" })).toBe(true);
    expect(parse({ range: "custom", from: "2026-10-01T00:00:00Z", to: "2026-10-31" })).toBe(true);
    expect(parse({ range: "custom", from: "2026-02-31", to: "2026-10-31" })).toBe(true);
    expect(parse({ range: "custom", from: "2026-10-31", to: "2026-10-01" })).toBe(true);
  });
});
