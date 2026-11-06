import { NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { groupExchangeRates, groups } from "@/db/schema";
import { assertGroupMember, getAuth } from "@/lib/auth";
import { withAuth } from "@/lib/auth/route";
import { loadGroupRateContext } from "@/lib/fx";
import { n } from "@/lib/money";
import { logRateLock } from "@/lib/record-mutation";
import {
  affectedCurrencyFor,
  applyRateLock,
  lockedIds,
  planRateLock,
  type RateLockPlan,
} from "@/lib/rate-lock";
import { SUPPORTED_CURRENCIES } from "@/lib/zod";
import { requireId } from "@/lib/route-params";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * Resolve the pins needed to freeze the records a (base, quote) rate change
 * would re-convert, BEFORE the change is written: each affected record gets
 * its current effective rate (existing group rate or per-day market rate).
 * Network/cache lookups happen here, outside the write transaction. Returns
 * `plan: null` when nothing needs locking (dormant pair), or an error
 * response when the group is missing or a market rate can't be resolved.
 */
async function planLockForPair(
  groupId: number,
  base: string,
  quote: string,
): Promise<{ plan: RateLockPlan | null; error?: NextResponse }> {
  const [group] = await db
    .select({ defaultCurrency: groups.defaultCurrency })
    .from(groups)
    .where(eq(groups.id, groupId));
  if (!group) {
    return { plan: null, error: NextResponse.json({ error: "group not found" }, { status: 404 }) };
  }

  const lockCurrency = affectedCurrencyFor({ base, quote }, group.defaultCurrency);
  if (!lockCurrency) return { plan: null };

  try {
    const rateCtx = await loadGroupRateContext(groupId);
    return { plan: await planRateLock(groupId, lockCurrency, group.defaultCurrency, rateCtx) };
  } catch {
    return {
      plan: null,
      error: NextResponse.json(
        { error: "無法取得既有紀錄的歷史匯率，請稍後再試" },
        { status: 502 },
      ),
    };
  }
}

export const GET = withAuth(async (req: Request, { params }: Params) => {
  const auth = await getAuth(req);
  const groupId = requireId((await params).id, "group id");
  await assertGroupMember(auth.user.id, groupId);

  const [group] = await db
    .select({ defaultCurrency: groups.defaultCurrency })
    .from(groups)
    .where(eq(groups.id, groupId));
  if (!group) return NextResponse.json({ error: "group not found" }, { status: 404 });

  const rows = await db
    .select()
    .from(groupExchangeRates)
    .where(eq(groupExchangeRates.groupId, groupId))
    .orderBy(asc(groupExchangeRates.base), asc(groupExchangeRates.quote));

  return NextResponse.json({
    defaultCurrency: group.defaultCurrency,
    rates: rows.map((r) => ({
      id: r.id,
      base: r.base,
      quote: r.quote,
      rate: n(r.rate),
      updatedAt: r.updatedAt,
    })),
  });
});

const putSchema = z
  .object({
    base: z.enum(SUPPORTED_CURRENCIES),
    quote: z.enum(SUPPORTED_CURRENCIES),
    rate: z.number().positive().max(1_000_000_000),
    /** Pin existing expenses at their current effective rate before saving,
     *  so the new group rate only affects future records. */
    lockExisting: z.boolean().optional(),
  })
  .refine((d) => d.base !== d.quote, { message: "base and quote must differ" });

export const PUT = withAuth(async (req: Request, { params }: Params) => {
  const auth = await getAuth(req);
  const groupId = requireId((await params).id, "group id");
  await assertGroupMember(auth.user.id, groupId);

  const body = putSchema.safeParse(await req.json());
  if (!body.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const { base, quote, rate, lockExisting } = body.data;

  let plan: RateLockPlan | null = null;
  if (lockExisting) {
    const result = await planLockForPair(groupId, base, quote);
    if (result.error) return result.error;
    plan = result.plan;
  }

  const row = await db.transaction(async (tx) => {
    if (plan) await applyRateLock(tx, plan);
    // One agreed rate per currency pair: an explicit inverse row would shadow
    // the derived inverse of the new rate and let the two directions drift
    // apart, so replace it.
    await tx
      .delete(groupExchangeRates)
      .where(
        and(
          eq(groupExchangeRates.groupId, groupId),
          eq(groupExchangeRates.base, quote),
          eq(groupExchangeRates.quote, base),
        ),
      );
    const [saved] = await tx
      .insert(groupExchangeRates)
      .values({
        groupId,
        base,
        quote,
        rate: String(rate),
        createdBy: auth.user.id,
      })
      .onConflictDoUpdate({
        target: [groupExchangeRates.groupId, groupExchangeRates.base, groupExchangeRates.quote],
        set: { rate: String(rate), createdBy: auth.user.id, updatedAt: new Date() },
      })
      .returning();
    return saved;
  });

  // One row for a change that rewrote many records: the user performed a single
  // group-level action, and fanning it out would bury the day's real edits.
  // The affected ids ride along so a single record's history can still explain
  // why its converted amount moved.
  if (plan) {
    await logRateLock(
      groupId,
      { userId: auth.user.id, source: "app" },
      {
        kind: "rateLock",
        base: plan.base,
        quote: plan.quote,
        // The plan is always stated as affected-currency → group default, while
        // the request may name the pair the other way round. Logging the
        // request's number under the plan's pair would print an inverted rate.
        rate: base === plan.base ? rate : 1 / rate,
        ...lockedIds(plan),
      },
    );
  }

  return NextResponse.json({
    id: row.id,
    base: row.base,
    quote: row.quote,
    rate: n(row.rate),
    updatedAt: row.updatedAt,
    lockedExpenses: plan?.lockedExpenses ?? 0,
    lockedSettlements: plan?.lockedSettlements ?? 0,
  });
});

const deleteSchema = z.object({
  base: z.enum(SUPPORTED_CURRENCIES),
  quote: z.enum(SUPPORTED_CURRENCIES),
});

/**
 * Remove a group custom rate. With `?lock=1`, affected records are first
 * pinned at the rate being deleted (their current effective rate), so the
 * delete only changes how FUTURE records convert; without it, old records
 * fall back to market rates.
 */
export const DELETE = withAuth(async (req: Request, { params }: Params) => {
  const auth = await getAuth(req);
  const groupId = requireId((await params).id, "group id");
  await assertGroupMember(auth.user.id, groupId);

  const url = new URL(req.url);
  const parsed = deleteSchema.safeParse({
    base: url.searchParams.get("base"),
    quote: url.searchParams.get("quote"),
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid base/quote" }, { status: 400 });
  }
  const { base, quote } = parsed.data;
  const lock = url.searchParams.get("lock") === "1";

  // Planning runs while the rate still exists, so locked records get frozen
  // at the rate being deleted — that's the point.
  let plan: RateLockPlan | null = null;
  if (lock) {
    const result = await planLockForPair(groupId, base, quote);
    if (result.error) return result.error;
    plan = result.plan;
  }

  await db.transaction(async (tx) => {
    if (plan) await applyRateLock(tx, plan);
    await tx
      .delete(groupExchangeRates)
      .where(
        and(
          eq(groupExchangeRates.groupId, groupId),
          eq(groupExchangeRates.base, base),
          eq(groupExchangeRates.quote, quote),
        ),
      );
  });

  if (plan) {
    // rate null: the agreed rate is gone, and the pins now hold what it was.
    await logRateLock(
      groupId,
      { userId: auth.user.id, source: "app" },
      { kind: "rateLock", base: plan.base, quote: plan.quote, rate: null, ...lockedIds(plan) },
    );
  }

  return NextResponse.json({
    ok: true,
    lockedExpenses: plan?.lockedExpenses ?? 0,
    lockedSettlements: plan?.lockedSettlements ?? 0,
  });
});
