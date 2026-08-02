import { NextResponse } from "next/server";
import { and, eq, gte, lte, min } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { expensePayers, expenseSplits, expenses, groups, users } from "@/db/schema";
import { assertGroupMember, getAuth } from "@/lib/auth";
import { withAuth } from "@/lib/auth/route";
import { loadGroupRateOverrides, resolveRate } from "@/lib/fx";
import { n } from "@/lib/money";
import {
  computeNetTrend,
  monthKeyToDate,
  monthKeysBetween,
  resolveStatsRange,
  type NetLeg,
  type StatsRangeKey,
} from "@/lib/stats-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Hard cap on how many bars the monthly chart renders — "全部" on an old
 *  group still shows only the most recent MAX_MONTHS; the net-trend line and
 *  the ranking block are unaffected and cover the full selected window. */
const MAX_MONTHS = 24;

const querySchema = z.object({
  userId: z.coerce.number().int().positive().optional(),
  range: z.enum(["3m", "6m", "1y", "all", "custom"]).default("6m"),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export const GET = withAuth(async (req: Request, { params }: Params) => {
  const auth = await getAuth(req);
  const groupId = Number((await params).id);
  if (!Number.isFinite(groupId)) {
    return NextResponse.json({ error: "invalid group id" }, { status: 400 });
  }
  await assertGroupMember(auth.user.id, groupId);

  const url = new URL(req.url);
  const parsed = querySchema.safeParse({
    userId: url.searchParams.get("userId") ?? undefined,
    range: url.searchParams.get("range") ?? undefined,
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid query params" }, { status: 400 });
  }
  const { range, from: customFrom, to: customTo } = parsed.data;
  const selectedUserId = parsed.data.userId ?? auth.user.id;
  await assertGroupMember(selectedUserId, groupId);

  const [group] = await db.select().from(groups).where(eq(groups.id, groupId));
  if (!group) return NextResponse.json({ error: "group not found" }, { status: 404 });

  let resolved: { from: Date | null; to: Date };
  try {
    resolved = resolveStatsRange(range as StatsRangeKey, new Date(), customFrom, customTo);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "invalid range" },
      { status: 400 },
    );
  }
  const resolvedTo = resolved.to;

  let effectiveFrom = resolved.from;
  if (!effectiveFrom) {
    const [earliest] = await db
      .select({ earliest: min(expenses.spentAt) })
      .from(expenses)
      .where(eq(expenses.groupId, groupId));
    effectiveFrom = earliest?.earliest ?? group.createdAt;
  }

  const overrides = await loadGroupRateOverrides(groupId);

  // Monthly bar chart: capped to the most recent MAX_MONTHS for readability,
  // independent of how far back the net-trend/ranking window goes.
  const allMonthKeys = monthKeysBetween(effectiveFrom, resolvedTo);
  const monthKeys =
    allMonthKeys.length > MAX_MONTHS ? allMonthKeys.slice(-MAX_MONTHS) : allMonthKeys;
  const monthlyWindowStart = monthKeyToDate(monthKeys[0]);

  const [expenseRows, memberSplitRows, payerRowsInRange] = await Promise.all([
    db
      .select({
        amount: expenses.amount,
        currency: expenses.currency,
        spentAt: expenses.spentAt,
        fxRate: expenses.fxRate,
        fxQuote: expenses.fxQuote,
      })
      .from(expenses)
      .where(
        and(
          eq(expenses.groupId, groupId),
          eq(expenses.type, "expense"),
          gte(expenses.spentAt, monthlyWindowStart),
          lte(expenses.spentAt, resolvedTo),
        ),
      ),
    db
      .select({
        amount: expenseSplits.amount,
        currency: expenses.currency,
        spentAt: expenses.spentAt,
        fxRate: expenses.fxRate,
        fxQuote: expenses.fxQuote,
      })
      .from(expenseSplits)
      .innerJoin(expenses, eq(expenses.id, expenseSplits.expenseId))
      .where(
        and(
          eq(expenses.groupId, groupId),
          eq(expenses.type, "expense"),
          eq(expenseSplits.debtorId, selectedUserId),
          gte(expenses.spentAt, monthlyWindowStart),
          lte(expenses.spentAt, resolvedTo),
        ),
      ),
    db
      .select({
        amount: expensePayers.amount,
        currency: expenses.currency,
        spentAt: expenses.spentAt,
        fxRate: expenses.fxRate,
        fxQuote: expenses.fxQuote,
        payerId: expensePayers.payerId,
        payerFirstName: users.firstName,
        payerLastName: users.lastName,
        payerUsername: users.username,
      })
      .from(expensePayers)
      .innerJoin(expenses, eq(expenses.id, expensePayers.expenseId))
      .innerJoin(users, eq(users.id, expensePayers.payerId))
      .where(
        and(
          eq(expenses.groupId, groupId),
          eq(expenses.type, "expense"),
          gte(expenses.spentAt, effectiveFrom),
          lte(expenses.spentAt, resolvedTo),
        ),
      ),
  ]);

  // Net trend needs the selected member's full history up to `to` (both
  // expenses and settlements) so the running total is never reset to 0 —
  // resolveStatsRange/computeNetTrend anchor the visible window at `from`.
  const [netPaidRows, netSplitRows] = await Promise.all([
    db
      .select({
        amount: expensePayers.amount,
        currency: expenses.currency,
        spentAt: expenses.spentAt,
        fxRate: expenses.fxRate,
        fxQuote: expenses.fxQuote,
      })
      .from(expensePayers)
      .innerJoin(expenses, eq(expenses.id, expensePayers.expenseId))
      .where(
        and(
          eq(expenses.groupId, groupId),
          eq(expensePayers.payerId, selectedUserId),
          lte(expenses.spentAt, resolvedTo),
        ),
      ),
    db
      .select({
        amount: expenseSplits.amount,
        currency: expenses.currency,
        spentAt: expenses.spentAt,
        fxRate: expenses.fxRate,
        fxQuote: expenses.fxQuote,
      })
      .from(expenseSplits)
      .innerJoin(expenses, eq(expenses.id, expenseSplits.expenseId))
      .where(
        and(
          eq(expenses.groupId, groupId),
          eq(expenseSplits.debtorId, selectedUserId),
          lte(expenses.spentAt, resolvedTo),
        ),
      ),
  ]);

  // Monthly group total + the selected member's monthly share, zero-filled.
  const monthly = monthKeys.map((month) => ({ month, groupTotal: 0, memberShare: 0 }));
  const monthIndex = new Map(monthly.map((m, idx) => [m.month, idx]));
  for (const r of expenseRows) {
    const rate = await resolveRate(r, group.defaultCurrency, r.spentAt, overrides);
    const key = `${r.spentAt.getFullYear()}-${String(r.spentAt.getMonth() + 1).padStart(2, "0")}`;
    const idx = monthIndex.get(key);
    if (idx !== undefined)
      monthly[idx].groupTotal =
        Math.round((monthly[idx].groupTotal + n(r.amount) * rate) * 100) / 100;
  }
  for (const r of memberSplitRows) {
    const rate = await resolveRate(r, group.defaultCurrency, r.spentAt, overrides);
    const key = `${r.spentAt.getFullYear()}-${String(r.spentAt.getMonth() + 1).padStart(2, "0")}`;
    const idx = monthIndex.get(key);
    if (idx !== undefined)
      monthly[idx].memberShare =
        Math.round((monthly[idx].memberShare + n(r.amount) * rate) * 100) / 100;
  }

  // Ranking ("誰花得最多"): each member's payer contribution within the range.
  const byPayerMap = new Map<
    number,
    {
      userId: number;
      firstName: string;
      lastName: string | null;
      username: string | null;
      total: number;
    }
  >();
  for (const r of payerRowsInRange) {
    const rate = await resolveRate(r, group.defaultCurrency, r.spentAt, overrides);
    const cur = byPayerMap.get(r.payerId) ?? {
      userId: r.payerId,
      firstName: r.payerFirstName,
      lastName: r.payerLastName,
      username: r.payerUsername,
      total: 0,
    };
    cur.total += n(r.amount) * rate;
    byPayerMap.set(r.payerId, cur);
  }
  const byPayer = Array.from(byPayerMap.values())
    .map((p) => ({ ...p, total: Math.round(p.total * 100) / 100 }))
    .sort((a, b) => b.total - a.total);

  // Net trend: paid legs positive, split legs negative, both currency-normalised.
  const netLegs: NetLeg[] = [];
  for (const r of netPaidRows) {
    const rate = await resolveRate(r, group.defaultCurrency, r.spentAt, overrides);
    netLegs.push({ date: r.spentAt, amount: n(r.amount) * rate });
  }
  for (const r of netSplitRows) {
    const rate = await resolveRate(r, group.defaultCurrency, r.spentAt, overrides);
    netLegs.push({ date: r.spentAt, amount: -n(r.amount) * rate });
  }
  const netTrend = computeNetTrend(netLegs, effectiveFrom);

  return NextResponse.json({
    currency: group.defaultCurrency,
    selectedUserId,
    range: { key: range, from: effectiveFrom.toISOString(), to: resolvedTo.toISOString() },
    monthly,
    netTrend,
    byPayer,
  });
});
