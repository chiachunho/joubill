import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { expenses, groups, users } from "@/db/schema";
import { assertGroupMember, getAuth } from "@/lib/auth";
import { withAuth } from "@/lib/auth/route";
import { getRate } from "@/lib/fx";
import { n } from "@/lib/money";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const MONTHS_BACK = 6;

export const GET = withAuth(async (req: Request, { params }: Params) => {
  const auth = await getAuth(req);
  const groupId = Number((await params).id);
  if (!Number.isFinite(groupId)) {
    return NextResponse.json({ error: "invalid group id" }, { status: 400 });
  }
  await assertGroupMember(auth.user.id, groupId);

  const [group] = await db.select().from(groups).where(eq(groups.id, groupId));
  if (!group) return NextResponse.json({ error: "group not found" }, { status: 404 });

  const rows = await db
    .select({
      amount: expenses.amount,
      currency: expenses.currency,
      spentAt: expenses.spentAt,
      payerId: expenses.payerId,
      payerFirstName: users.firstName,
      payerLastName: users.lastName,
      payerUsername: users.username,
    })
    .from(expenses)
    .innerJoin(users, eq(users.id, expenses.payerId))
    .where(eq(expenses.groupId, groupId));

  // Normalize each amount to the group's default currency via FX cache.
  const normalized: Array<{
    value: number;
    spentAt: Date;
    payerId: number;
    payerFirstName: string;
    payerLastName: string | null;
    payerUsername: string | null;
  }> = [];
  for (const r of rows) {
    const rate = await getRate(r.currency, group.defaultCurrency, r.spentAt);
    normalized.push({
      value: n(r.amount) * rate,
      spentAt: r.spentAt,
      payerId: r.payerId,
      payerFirstName: r.payerFirstName,
      payerLastName: r.payerLastName,
      payerUsername: r.payerUsername,
    });
  }

  // Build a 6-month window ending at the current month (zero-filled).
  const now = new Date();
  const monthly: Array<{ month: string; total: number }> = [];
  for (let i = MONTHS_BACK - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    monthly.push({ month: key, total: 0 });
  }
  const monthIndex = new Map(monthly.map((m, idx) => [m.month, idx]));
  for (const r of normalized) {
    const key = `${r.spentAt.getFullYear()}-${String(r.spentAt.getMonth() + 1).padStart(2, "0")}`;
    const idx = monthIndex.get(key);
    if (idx !== undefined) monthly[idx].total = Math.round((monthly[idx].total + r.value) * 100) / 100;
  }

  // Per-payer totals across the entire group history.
  const byPayerMap = new Map<
    number,
    { userId: number; firstName: string; lastName: string | null; username: string | null; total: number }
  >();
  for (const r of normalized) {
    const cur = byPayerMap.get(r.payerId) ?? {
      userId: r.payerId,
      firstName: r.payerFirstName,
      lastName: r.payerLastName,
      username: r.payerUsername,
      total: 0,
    };
    cur.total += r.value;
    byPayerMap.set(r.payerId, cur);
  }
  const byPayer = Array.from(byPayerMap.values())
    .map((p) => ({ ...p, total: Math.round(p.total * 100) / 100 }))
    .sort((a, b) => b.total - a.total);

  return NextResponse.json({
    currency: group.defaultCurrency,
    monthly,
    byPayer,
  });
});
