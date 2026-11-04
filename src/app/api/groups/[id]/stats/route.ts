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
  recentMonthKeys,
  resolveStatsRange,
  type NetLeg,
  type StatsRangeKey,
} from "@/lib/stats-core";
import { requireId } from "@/lib/route-params";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Hard cap on how many bars the monthly chart renders — "全部" on an old
 *  group still shows only the most recent MAX_MONTHS; the net-trend line and
 *  the ranking block are unaffected and cover the full selected window. */
const MAX_MONTHS = 24;

const querySchema = z.object({
  range: z.enum(["3m", "6m", "1y", "all", "custom"]).default("6m"),
  // Full ISO instants, not bare "YYYY-MM-DD" — only the browser knows the
  // viewer's local day boundaries, so it resolves those itself
  // (`customRangeToQueryBounds` in stats-core.ts) before this ever sees them.
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
});

export const GET = withAuth(async (req: Request, { params }: Params) => {
  const auth = await getAuth(req);
  const groupId = requireId((await params).id, "group id");
  await assertGroupMember(auth.user.id, groupId);

  const url = new URL(req.url);
  const userIdParam = url.searchParams.get("userId");
  const parsed = querySchema.safeParse({
    range: url.searchParams.get("range") ?? undefined,
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid query params" }, { status: 400 });
  }
  const { range, from: customFrom, to: customTo } = parsed.data;
  const selectedUserId = userIdParam != null ? requireId(userIdParam, "userId") : auth.user.id;
  // Already proven a member above when selectedUserId === auth.user.id (the
  // common case: viewing your own stats) — skip the redundant lookup.
  if (selectedUserId !== auth.user.id) {
    await assertGroupMember(selectedUserId, groupId);
  }

  const [group] = await db.select().from(groups).where(eq(groups.id, groupId));
  if (!group) return NextResponse.json({ error: "group not found" }, { status: 404 });

  let resolved: { from: Date | null; to: Date; monthsBack?: number };
  try {
    resolved = resolveStatsRange(range as StatsRangeKey, new Date(), customFrom, customTo);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "invalid range" },
      { status: 400 },
    );
  }
  const resolvedTo = resolved.to;

  // effectiveFrom anchors the net trend (settlement-inclusive — a settlement
  // is a real balance-changing event, so "all" history starts there, not at
  // the first *expense*). earliestExpenseDate is only for bounding the
  // monthly chart/ranking on "all", so a group whose very first record
  // happens to be a settlement doesn't get padded with zero-filled months
  // before any real expense existed.
  let effectiveFrom = resolved.from;
  let earliestExpenseDate: Date | null = null;
  if (!effectiveFrom) {
    const [[earliestAny], [earliestExpense]] = await Promise.all([
      db
        .select({ earliest: min(expenses.spentAt) })
        .from(expenses)
        .where(eq(expenses.groupId, groupId)),
      db
        .select({ earliest: min(expenses.spentAt) })
        .from(expenses)
        .where(and(eq(expenses.groupId, groupId), eq(expenses.type, "expense"))),
    ]);
    effectiveFrom = earliestAny?.earliest ?? group.createdAt;
    // A record can be future-dated (no validation prevents it) — if the
    // "earliest" record somehow lands after `to` (=now for "all"), clamp so
    // monthKeysBetween/monthKeys[0] below never see an inverted range.
    if (effectiveFrom.getTime() > resolvedTo.getTime()) effectiveFrom = resolvedTo;
    earliestExpenseDate = earliestExpense?.earliest ?? effectiveFrom;
    if (earliestExpenseDate.getTime() > resolvedTo.getTime()) earliestExpenseDate = resolvedTo;
  }

  const overrides = await loadGroupRateOverrides(groupId);
  // Per-request memoization: many rows share the same (currency, quote, day),
  // so this both avoids redundant `getRate` DB/API round-trips and lets every
  // loop below resolve its rates in parallel instead of one `await` at a time.
  const rateCache = new Map<string, Promise<number>>();
  function cachedRate(
    record: { currency: string; fxRate: string | number | null; fxQuote: string | null },
    at: Date,
  ): Promise<number> {
    const key = `${record.currency}|${at.toISOString().slice(0, 10)}|${record.fxRate ?? ""}|${record.fxQuote ?? ""}`;
    let rate = rateCache.get(key);
    if (!rate) {
      rate = resolveRate(record, group.defaultCurrency, at, overrides);
      rateCache.set(key, rate);
    }
    return rate;
  }

  // Monthly chart / ranking share one window, built differently per range:
  //   - presets (3m/6m/1y): the last `monthsBack` *calendar* months ending
  //     at `to`'s month — always exactly N, matching the help doc's "選 6
  //     個月會看到 6 根長條". This is deliberately NOT the same window as
  //     the net trend's exact day-count `effectiveFrom`: a bar chart reads
  //     "6 個月" as 6 labeled months, a continuous trend line as 6 months
  //     of days — two reasonable, different interpretations of the words.
  //   - all: from the earliest *expense* (not the settlement-inclusive
  //     effectiveFrom), so idle months before any real expense don't show
  //     up as a run of zero-filled bars.
  //   - custom: the viewer's exact picked window (no "N months" promise).
  // Monthly and the ranking always share this window with each other.
  let allMonthKeys: string[];
  let rangeQueryStart: Date;
  if (resolved.monthsBack !== undefined) {
    allMonthKeys = recentMonthKeys(resolvedTo, resolved.monthsBack);
    rangeQueryStart = monthKeyToDate(allMonthKeys[0]);
  } else if (range === "all") {
    allMonthKeys = monthKeysBetween(earliestExpenseDate!, resolvedTo);
    rangeQueryStart = earliestExpenseDate!;
  } else {
    allMonthKeys = monthKeysBetween(effectiveFrom, resolvedTo);
    rangeQueryStart = effectiveFrom;
  }
  const isCapped = allMonthKeys.length > MAX_MONTHS;
  const monthKeys = isCapped ? allMonthKeys.slice(-MAX_MONTHS) : allMonthKeys;
  const monthlyQueryStart = isCapped ? monthKeyToDate(monthKeys[0]) : rangeQueryStart;

  // All five row queries are independent of each other — one Promise.all so
  // a slow connection pays for one round trip, not two sequential ones.
  const [expenseRows, memberSplitRows, payerRowsInRange, netPaidRows, netSplitRows] =
    await Promise.all([
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
            gte(expenses.spentAt, monthlyQueryStart),
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
            gte(expenses.spentAt, monthlyQueryStart),
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
          payerDisplayName: users.displayName,
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
            gte(expenses.spentAt, monthlyQueryStart),
            lte(expenses.spentAt, resolvedTo),
          ),
        ),
      // Net trend needs the selected member's full history up to `to` (both
      // expenses and settlements) so the running total is never reset to 0 —
      // resolveStatsRange/computeNetTrend anchor the visible window at `from`.
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

  // Resolve every row's FX rate up front, in parallel (deduped by cachedRate)
  // — then aggregate synchronously below so no two rows racing on the same
  // accumulator can interleave between a read and its write.
  const [expenseRates, memberSplitRates, payerRates, netPaidRates, netSplitRates] =
    await Promise.all([
      Promise.all(expenseRows.map((r) => cachedRate(r, r.spentAt))),
      Promise.all(memberSplitRows.map((r) => cachedRate(r, r.spentAt))),
      Promise.all(payerRowsInRange.map((r) => cachedRate(r, r.spentAt))),
      Promise.all(netPaidRows.map((r) => cachedRate(r, r.spentAt))),
      Promise.all(netSplitRows.map((r) => cachedRate(r, r.spentAt))),
    ]);

  // Monthly group total + the selected member's monthly share, zero-filled.
  const monthly = monthKeys.map((month) => ({ month, groupTotal: 0, memberShare: 0 }));
  const monthIndex = new Map(monthly.map((m, idx) => [m.month, idx]));
  expenseRows.forEach((r, i) => {
    const key = `${r.spentAt.getFullYear()}-${String(r.spentAt.getMonth() + 1).padStart(2, "0")}`;
    const idx = monthIndex.get(key);
    if (idx !== undefined)
      monthly[idx].groupTotal =
        Math.round((monthly[idx].groupTotal + n(r.amount) * expenseRates[i]) * 100) / 100;
  });
  memberSplitRows.forEach((r, i) => {
    const key = `${r.spentAt.getFullYear()}-${String(r.spentAt.getMonth() + 1).padStart(2, "0")}`;
    const idx = monthIndex.get(key);
    if (idx !== undefined)
      monthly[idx].memberShare =
        Math.round((monthly[idx].memberShare + n(r.amount) * memberSplitRates[i]) * 100) / 100;
  });

  // Ranking ("誰花得最多"): each member's payer contribution within the range.
  const byPayerMap = new Map<
    number,
    {
      userId: number;
      displayName: string | null;
      firstName: string;
      lastName: string | null;
      username: string | null;
      total: number;
    }
  >();
  payerRowsInRange.forEach((r, i) => {
    const cur = byPayerMap.get(r.payerId) ?? {
      userId: r.payerId,
      displayName: r.payerDisplayName,
      firstName: r.payerFirstName,
      lastName: r.payerLastName,
      username: r.payerUsername,
      total: 0,
    };
    cur.total += n(r.amount) * payerRates[i];
    byPayerMap.set(r.payerId, cur);
  });
  const byPayer = Array.from(byPayerMap.values())
    .map((p) => ({ ...p, total: Math.round(p.total * 100) / 100 }))
    .sort((a, b) => b.total - a.total);

  // Net trend: paid legs positive, split legs negative, both currency-normalised.
  const netLegs: NetLeg[] = [
    ...netPaidRows.map((r, i) => ({ date: r.spentAt, amount: n(r.amount) * netPaidRates[i] })),
    ...netSplitRows.map((r, i) => ({ date: r.spentAt, amount: -n(r.amount) * netSplitRates[i] })),
  ];
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
