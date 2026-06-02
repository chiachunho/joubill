import { describe, expect, it } from "vitest";

import { minimizeTransfers, type NetBalance } from "../settlement-core";

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
});
