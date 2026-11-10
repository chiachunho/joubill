import { describe, expect, it } from "vitest";

import {
  DUST_CENTS,
  MAX_EXACT_PEOPLE,
  minimizeTransfers,
  type NetBalance,
} from "../settlement-core";

function sumByUser(transfers: ReturnType<typeof minimizeTransfers>) {
  const net = new Map<number, number>();
  for (const t of transfers) {
    net.set(t.fromUserId, (net.get(t.fromUserId) ?? 0) - t.amount);
    net.set(t.toUserId, (net.get(t.toUserId) ?? 0) + t.amount);
  }
  return net;
}

describe("minimizeTransfers", () => {
  it("returns nothing when everyone is square", () => {
    expect(minimizeTransfers([])).toEqual([]);
    expect(minimizeTransfers([{ userId: 1, amount: 0 }])).toEqual([]);
  });

  it("settles a simple two-party debt", () => {
    const balances: NetBalance[] = [
      { userId: 1, amount: 15 },
      { userId: 2, amount: -15 },
    ];
    const transfers = minimizeTransfers(balances);
    expect(transfers).toEqual([{ fromUserId: 2, toUserId: 1, amount: 15 }]);
  });

  it("pairs one creditor with multiple debtors", () => {
    const balances: NetBalance[] = [
      { userId: 1, amount: 30 },
      { userId: 2, amount: -15 },
      { userId: 3, amount: -15 },
    ];
    const transfers = minimizeTransfers(balances);
    // Two transfers, both flowing to user 1.
    expect(transfers).toHaveLength(2);
    expect(transfers.every((t) => t.toUserId === 1)).toBe(true);
  });

  it("conserves money: net of transfers equals input balances", () => {
    const balances: NetBalance[] = [
      { userId: 1, amount: 50 },
      { userId: 2, amount: 20 },
      { userId: 3, amount: -30 },
      { userId: 4, amount: -40 },
    ];
    const net = sumByUser(minimizeTransfers(balances));
    for (const b of balances) {
      expect(net.get(b.userId) ?? 0).toBeCloseTo(b.amount, 2);
    }
  });

  it("produces at most n-1 transfers for n participants", () => {
    const balances: NetBalance[] = [
      { userId: 1, amount: 10 },
      { userId: 2, amount: 10 },
      { userId: 3, amount: 10 },
      { userId: 4, amount: -30 },
    ];
    const transfers = minimizeTransfers(balances);
    expect(transfers.length).toBeLessThanOrEqual(3);
  });

  it("ignores sub-cent dust", () => {
    const balances: NetBalance[] = [
      { userId: 1, amount: 0.004 },
      { userId: 2, amount: -0.004 },
    ];
    expect(minimizeTransfers(balances)).toEqual([]);
  });

  it("correctly settles a multi-payer expense split equally", () => {
    // User 1 paid 180, user 2 paid 120 for a 300 dinner split equally among all 3.
    // Each owes 100 → net: user 1 = +80, user 2 = +20, user 3 = -100.
    const balances: NetBalance[] = [
      { userId: 1, amount: 80 },
      { userId: 2, amount: 20 },
      { userId: 3, amount: -100 },
    ];
    const transfers = minimizeTransfers(balances);
    // User 3 owes 80 to user 1 and 20 to user 2.
    expect(transfers).toHaveLength(2);
    const net = sumByUser(transfers);
    expect(net.get(1) ?? 0).toBeCloseTo(80, 2);
    expect(net.get(2) ?? 0).toBeCloseTo(20, 2);
    expect(net.get(3) ?? 0).toBeCloseTo(-100, 2);
  });

  it("correctly settles when two payers and one debtor", () => {
    // User 1 paid 60, user 2 paid 40 for a 100 expense; user 3 is the sole debtor.
    // Net: user 1 = +60, user 2 = +40, user 3 = -100.
    const balances: NetBalance[] = [
      { userId: 1, amount: 60 },
      { userId: 2, amount: 40 },
      { userId: 3, amount: -100 },
    ];
    const transfers = minimizeTransfers(balances);
    expect(transfers).toHaveLength(2);
    const net = sumByUser(transfers);
    expect(net.get(1) ?? 0).toBeCloseTo(60, 2);
    expect(net.get(2) ?? 0).toBeCloseTo(40, 2);
    expect(net.get(3) ?? 0).toBeCloseTo(-100, 2);
  });

  it("handles payer who is also a debtor in the same expense", () => {
    // 300 dinner: user 1 paid full 300, split equally (100 each).
    // But now user 1 also paid 100 extra as a second payer toward user 4.
    // Simplified: user 1 net +200, user 2 net -100, user 3 net -100 (user 4 is a payer who owes nothing extra).
    const balances: NetBalance[] = [
      { userId: 1, amount: 200 },
      { userId: 2, amount: -100 },
      { userId: 3, amount: -100 },
    ];
    const transfers = minimizeTransfers(balances);
    const net = sumByUser(transfers);
    expect(net.get(1) ?? 0).toBeCloseTo(200, 2);
    expect(net.get(2) ?? 0).toBeCloseTo(-100, 2);
    expect(net.get(3) ?? 0).toBeCloseTo(-100, 2);
  });

  it("finds the 3-transfer answer where greedy needs 4 (issue #170)", () => {
    const balances: NetBalance[] = [
      { userId: 1, amount: 10 }, // A
      { userId: 2, amount: 5 }, // B
      { userId: 3, amount: -7 }, // C
      { userId: 4, amount: -5 }, // D
      { userId: 5, amount: -3 }, // E
    ];
    const transfers = minimizeTransfers(balances);
    expect(transfers).toHaveLength(3);
    // D and B settle between themselves.
    expect(transfers).toContainEqual({ fromUserId: 4, toUserId: 2, amount: 5 });
    const net = sumByUser(transfers);
    for (const b of balances) expect(net.get(b.userId) ?? 0).toBeCloseTo(b.amount, 2);
  });

  it("is deterministic and orders the largest transfer first", () => {
    const balances: NetBalance[] = [
      { userId: 1, amount: 10 },
      { userId: 2, amount: 5 },
      { userId: 3, amount: -7 },
      { userId: 4, amount: -5 },
      { userId: 5, amount: -3 },
    ];
    const a = minimizeTransfers(balances);
    expect(minimizeTransfers([...balances].reverse())).toEqual(a);
    expect(a.map((t) => t.amount)).toEqual([7, 5, 3]);
  });

  it("settles when FX rounding leaves the cents a little off zero", () => {
    // Sums to +0.01 after rounding to cents.
    const balances: NetBalance[] = [
      { userId: 1, amount: 33.336 },
      { userId: 2, amount: 33.336 },
      { userId: 3, amount: -66.662 },
    ];
    const transfers = minimizeTransfers(balances);
    expect(transfers).toHaveLength(2);
    const net = sumByUser(transfers);
    for (const b of balances)
      expect(Math.abs((net.get(b.userId) ?? 0) - b.amount)).toBeLessThan(0.03);
    for (const t of transfers) expect(Math.round(t.amount * 100)).toBeCloseTo(t.amount * 100, 6);
  });

  it("asks for nothing more once the suggestion has been paid", () => {
    const balances: NetBalance[] = [
      { userId: 1, amount: 33.336 },
      { userId: 2, amount: 33.336 },
      { userId: 3, amount: -66.662 },
    ];
    const left = new Map(balances.map((b) => [b.userId, b.amount]));
    for (const t of minimizeTransfers(balances)) {
      left.set(t.fromUserId, left.get(t.fromUserId)! + t.amount);
      left.set(t.toUserId, left.get(t.toUserId)! - t.amount);
    }
    expect(minimizeTransfers([...left].map(([userId, amount]) => ({ userId, amount })))).toEqual(
      [],
    );
  });

  it("treats balances within the dust threshold as settled", () => {
    const dust = DUST_CENTS / 100;
    expect(
      minimizeTransfers([
        { userId: 1, amount: dust },
        { userId: 2, amount: -dust },
      ]),
    ).toEqual([]);
  });

  it("falls back to greedy above the exact limit, still conserving money", () => {
    const n = MAX_EXACT_PEOPLE + 6;
    const balances: NetBalance[] = [];
    for (let i = 1; i < n; i++) balances.push({ userId: i, amount: i % 2 ? i * 3 : -i * 3 });
    const total = balances.reduce((s, b) => s + b.amount, 0);
    balances.push({ userId: n, amount: -total });
    const transfers = minimizeTransfers(balances);
    expect(transfers.length).toBeLessThanOrEqual(n - 1);
    const net = sumByUser(transfers);
    for (const b of balances) expect(net.get(b.userId) ?? 0).toBeCloseTo(b.amount, 2);
  });

  it("solves the largest exact size quickly", () => {
    const n = MAX_EXACT_PEOPLE;
    const balances: NetBalance[] = [];
    let total = 0;
    for (let i = 1; i < n; i++) {
      const amount = ((i * 37) % 91) + 5;
      const signed = i % 2 ? amount : -amount;
      balances.push({ userId: i, amount: signed });
      total += signed;
    }
    balances.push({ userId: n, amount: -total });
    const start = Date.now();
    const transfers = minimizeTransfers(balances);
    expect(Date.now() - start).toBeLessThan(5000);
    const net = sumByUser(transfers);
    for (const b of balances) expect(net.get(b.userId) ?? 0).toBeCloseTo(b.amount, 2);
  });
});

/** Seeded PRNG so a failure can be reproduced. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Brute force: people minus the most zero-sum groups, found by trying every subset. */
function bestTransferCount(cents: number[]): number {
  const n = cents.length;
  const full = (1 << n) - 1;
  const sum = new Array<number>(1 << n).fill(0);
  for (let m = 1; m <= full; m++) {
    const low = m & -m;
    sum[m] = sum[m ^ low] + cents[31 - Math.clz32(low)];
  }
  const memo = new Map<number, number>();
  const groups = (mask: number): number => {
    if (mask === 0) return 0;
    const cached = memo.get(mask);
    if (cached !== undefined) return cached;
    const low = mask & -mask;
    let best = 0;
    // Every group containing the lowest person: enumerate submasks of the rest.
    const rest = mask ^ low;
    for (let sub = rest; ; sub = (sub - 1) & rest) {
      const group = sub | low;
      if (sum[group] === 0) best = Math.max(best, 1 + groups(mask ^ group));
      if (sub === 0) break;
    }
    memo.set(mask, best);
    return best;
  };
  return n - groups(full);
}

describe("minimizeTransfers against brute force", () => {
  it("matches the true minimum and conserves every balance (small groups)", () => {
    const rand = mulberry32(170);
    const value = () => (3 + Math.floor(rand() * 60)) * (rand() < 0.5 ? 1 : -1);
    let checked = 0;
    let withSubgroups = 0;
    for (let round = 0; round < 400; round++) {
      const n = 2 + Math.floor(rand() * 7); // 2..8
      // Cut n people into clusters; each cluster sums to exactly 0 by construction, so
      // settling inside clusters is possible (often with fewer transfers than greedy finds).
      const cents: number[] = [];
      while (cents.length < n) {
        const left = n - cents.length;
        let size = Math.min(left, 2 + Math.floor(rand() * 4));
        if (left - size === 1) size = left; // never strand a single person
        const cluster = Array.from({ length: size - 1 }, value);
        cents.push(...cluster, -cluster.reduce((s, c) => s + c, 0));
      }
      // Anyone inside the dust band is dropped by design, so keep to real balances.
      if (cents.some((c) => Math.abs(c) <= DUST_CENTS)) continue;

      const balances: NetBalance[] = cents.map((c, i) => ({ userId: i + 1, amount: c / 100 }));
      const transfers = minimizeTransfers(balances);

      const best = bestTransferCount(cents);
      expect(transfers).toHaveLength(best);
      if (best < n - 1) withSubgroups++;
      const net = sumByUser(transfers);
      for (const b of balances) expect(net.get(b.userId) ?? 0).toBeCloseTo(b.amount, 2);
      for (const t of transfers) expect(t.amount).toBeGreaterThan(0);
      checked++;
    }
    // Guard against the generator quietly skipping everything, or never producing subgroups.
    expect(checked).toBeGreaterThan(300);
    expect(withSubgroups).toBeGreaterThan(50);
  });
});
