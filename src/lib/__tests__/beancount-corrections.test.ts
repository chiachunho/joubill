import { describe, expect, it } from "vitest";

import {
  groupToBeancount,
  recordToBeancount,
  type BeancountAccounts,
  type BeancountRecord,
  type CorrectionGroup,
} from "@/lib/beancount";
import {
  planCorrection,
  snapshotToBeancountRecord,
  type CorrectionPlan,
} from "@/lib/beancount-corrections";
import type { RecordSnapshot } from "@/lib/record-audit";

const U = 1;
const BOB = 2;
const CAROL = 3;

const ACCOUNTS: BeancountAccounts = {
  expenses: "Expenses:Food",
  cash: "Assets:Cash",
  event: "Assets:Receivable:Trip",
};

function lunch(over: Partial<BeancountRecord> = {}): BeancountRecord {
  return {
    id: 7,
    type: "expense",
    amount: 300,
    currency: "TWD",
    description: "午餐",
    spentAt: "2026-06-30T08:00:00.000Z",
    payers: [{ userId: U, amount: 300 }],
    splits: [
      { userId: U, amount: 150 },
      { userId: BOB, amount: 150 },
    ],
    ...over,
  };
}

const plan = (exported: BeancountRecord, current: BeancountRecord | null, user = U) =>
  planCorrection(exported, current, user, ACCOUNTS);

/** Every posting line of a text, summed per account. */
function totals(text: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const line of text.split("\n")) {
    const m = /^ {2}(\S+)\s+(-?\d+\.\d{2}) /.exec(line);
    if (m) out[m[1]] = Math.round(((out[m[1]] ?? 0) + Number(m[2])) * 100) / 100;
  }
  return out;
}

describe("planCorrection", () => {
  it("reverses a deleted record", () => {
    const p = plan(lunch(), null);
    expect(p).toMatchObject({ kind: "correction", correction: "deleted", current: null });
  });

  it("reverses and rewrites an edited amount", () => {
    const now = lunch({
      amount: 360,
      payers: [{ userId: U, amount: 360 }],
      splits: [
        { userId: U, amount: 180 },
        { userId: BOB, amount: 180 },
      ],
    });
    const p = plan(lunch(), now);
    expect(p).toMatchObject({ kind: "correction", correction: "edited", current: now });
  });

  it("corrects an edited split", () => {
    const now = lunch({
      splits: [
        { userId: U, amount: 100 },
        { userId: BOB, amount: 100 },
        { userId: CAROL, amount: 100 },
      ],
    });
    expect(plan(lunch(), now).kind).toBe("correction");
  });

  it("only reverses when the edit takes the viewer out", () => {
    const now = lunch({
      payers: [{ userId: BOB, amount: 300 }],
      splits: [{ userId: CAROL, amount: 300 }],
    });
    expect(plan(lunch(), now)).toMatchObject({
      kind: "correction",
      correction: "edited",
      current: null,
    });
  });

  it("treats a record an edit makes relevant as new", () => {
    const before = lunch({
      payers: [{ userId: BOB, amount: 300 }],
      splits: [{ userId: CAROL, amount: 300 }],
    });
    expect(plan(before, lunch())).toEqual({ kind: "new", current: lunch() });
  });

  it("says nothing about a record that never touched the viewer", () => {
    const other = lunch({
      payers: [{ userId: BOB, amount: 300 }],
      splits: [{ userId: CAROL, amount: 300 }],
    });
    expect(plan(other, null).kind).toBe("none");
    expect(plan(other, lunch({ ...other, amount: 301 })).kind).toBe("none");
  });

  it("ignores an edit that leaves the viewer's transaction as it was", () => {
    expect(plan(lunch(), lunch({ description: "晚餐" })).kind).toBe("none");
  });

  it("corrects a changed date or currency even when the amounts match", () => {
    expect(plan(lunch(), lunch({ spentAt: "2026-07-02T08:00:00.000Z" })).kind).toBe("correction");
    expect(plan(lunch(), lunch({ currency: "JPY" })).kind).toBe("correction");
  });

  it("corrects a settlement that is redirected away from the viewer", () => {
    const stl = (to: number): BeancountRecord => ({
      id: 9,
      type: "settlement",
      amount: 150,
      currency: "TWD",
      description: null,
      spentAt: "2026-06-30T08:00:00.000Z",
      payers: [{ userId: BOB, amount: 150 }],
      splits: [{ userId: to, amount: 150 }],
    });
    expect(plan(stl(U), stl(U)).kind).toBe("none");
    expect(plan(stl(U), stl(CAROL))).toMatchObject({ kind: "correction", current: null });
  });
});

describe("a correction written into the file", () => {
  function render(p: CorrectionPlan, original: BeancountRecord) {
    if (p.kind !== "correction") throw new Error("expected a correction");
    const group: CorrectionGroup = [
      { record: p.reverse, rate: 1, correction: p.correction, reverse: true },
      ...(p.current
        ? [{ record: p.current, rate: 1, correction: p.correction, reverse: false }]
        : []),
    ];
    const { text, corrected } = groupToBeancount({
      groupTitle: "Trip",
      defaultCurrency: "TWD",
      userId: U,
      accounts: ACCOUNTS,
      range: { kind: "new", since: new Date("2026-06-01T00:00:00Z") },
      now: new Date("2026-07-05T00:00:00Z"),
      records: [],
      corrections: [group],
    });
    const first = recordToBeancount(original, U, ACCOUNTS)!;
    return { text, corrected, first };
  }

  it("nets the exported transaction to zero when the record is deleted", () => {
    const original = lunch();
    const { text, first, corrected } = render(plan(original, null), original);
    expect(corrected).toBe(1);
    expect(text).toContain('joubill_correction: "deleted"');
    for (const sum of Object.values(totals(`${first}\n${text}`))) expect(sum).toBe(0);
  });

  it("leaves only the new version once an edit's reversal is added", () => {
    const original = lunch();
    const now = lunch({
      amount: 360,
      payers: [{ userId: U, amount: 360 }],
      splits: [
        { userId: U, amount: 180 },
        { userId: BOB, amount: 180 },
      ],
    });
    const { text, first } = render(plan(original, now), original);
    expect(text.match(/joubill_correction: "edited"/g)).toHaveLength(2);
    expect(totals(`${first}\n${text}`)).toEqual({
      "Expenses:Food": 180,
      "Assets:Cash": -360,
      "Assets:Receivable:Trip": 180,
    });
  });

  it("never prints a negative zero", () => {
    const original = lunch({ splits: [{ userId: U, amount: 300 }] });
    const { text } = render(plan(original, null), original);
    expect(text).not.toContain("-0.00");
  });

  it("mentions the corrections in the header and leaves the open directive commented", () => {
    const { text } = render(plan(lunch(), null), lunch());
    expect(text).toContain("; 0 筆，修正 1 筆");
    expect(text).toMatch(/^; \d{4}-\d{2}-\d{2} open Assets:Receivable:Trip$/m);
  });
});

describe("snapshotToBeancountRecord", () => {
  const person = (userId: number) => ({
    userId,
    displayName: null,
    firstName: `P${userId}`,
    username: null,
    telegramId: null,
  });

  it("reads legs back as the record the export renders", () => {
    const snap: RecordSnapshot = {
      type: "expense",
      amount: 300,
      currency: "TWD",
      description: "午餐",
      payers: [{ user: person(U), amount: 300 }],
      splits: [
        { user: person(U), amount: 150 },
        { user: person(BOB), amount: 150 },
      ],
      spentAt: "2026-06-30T08:00:00.000Z",
      fxRate: null,
      fxQuote: null,
      receipts: 0,
    };
    expect(snapshotToBeancountRecord(7, snap)).toEqual(lunch());
  });
});
