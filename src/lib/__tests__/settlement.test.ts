import { describe, expect, it } from "vitest";

import { minimizeTransfers, type NetBalance } from "../settlement";

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
});
