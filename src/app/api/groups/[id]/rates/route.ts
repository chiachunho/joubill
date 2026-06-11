import { NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { groupExchangeRates, groups } from "@/db/schema";
import { assertGroupMember, getAuth } from "@/lib/auth";
import { withAuth } from "@/lib/auth/route";
import { loadGroupRateOverrides } from "@/lib/fx";
import { n } from "@/lib/money";
import {
  affectedCurrencyFor,
  applyRateLock,
  planRateLock,
  type RateLockPlan,
} from "@/lib/rate-lock";
import { SUPPORTED_CURRENCIES } from "@/lib/zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export const GET = withAuth(async (req: Request, { params }: Params) => {
  const auth = await getAuth(req);
  const groupId = Number((await params).id);
  if (!Number.isFinite(groupId)) {
    return NextResponse.json({ error: "invalid group id" }, { status: 400 });
  }
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
  const groupId = Number((await params).id);
  if (!Number.isFinite(groupId)) {
    return NextResponse.json({ error: "invalid group id" }, { status: 400 });
  }
  await assertGroupMember(auth.user.id, groupId);

  const body = putSchema.safeParse(await req.json());
  if (!body.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const { base, quote, rate, lockExisting } = body.data;

  // Resolve the pins BEFORE the new rate exists: each affected record gets its
  // current effective rate (old group rate or market rate as of its date), so
  // existing balances don't move. Network/cache lookups happen outside the
  // transaction below.
  let plan: RateLockPlan | null = null;
  if (lockExisting) {
    const [group] = await db
      .select({ defaultCurrency: groups.defaultCurrency })
      .from(groups)
      .where(eq(groups.id, groupId));
    if (!group) return NextResponse.json({ error: "group not found" }, { status: 404 });

    const lockCurrency = affectedCurrencyFor({ base, quote }, group.defaultCurrency);
    if (lockCurrency) {
      try {
        const overrides = await loadGroupRateOverrides(groupId);
        plan = await planRateLock(groupId, lockCurrency, group.defaultCurrency, overrides);
      } catch {
        return NextResponse.json(
          { error: "無法取得既有紀錄的歷史匯率，請稍後再試" },
          { status: 502 },
        );
      }
    }
  }

  const row = await db.transaction(async (tx) => {
    if (plan) await applyRateLock(tx, plan);
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
  const groupId = Number((await params).id);
  if (!Number.isFinite(groupId)) {
    return NextResponse.json({ error: "invalid group id" }, { status: 400 });
  }
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

  let plan: RateLockPlan | null = null;
  if (lock) {
    const [group] = await db
      .select({ defaultCurrency: groups.defaultCurrency })
      .from(groups)
      .where(eq(groups.id, groupId));
    if (!group) return NextResponse.json({ error: "group not found" }, { status: 404 });

    // A dormant rate (pair doesn't touch the default currency) affects nothing.
    const lockCurrency = affectedCurrencyFor({ base, quote }, group.defaultCurrency);
    if (lockCurrency) {
      try {
        // Overrides still include the rate being deleted — that's the point:
        // records get frozen at it.
        const overrides = await loadGroupRateOverrides(groupId);
        plan = await planRateLock(groupId, lockCurrency, group.defaultCurrency, overrides);
      } catch {
        return NextResponse.json(
          { error: "無法取得既有紀錄的歷史匯率，請稍後再試" },
          { status: 502 },
        );
      }
    }
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

  return NextResponse.json({
    ok: true,
    lockedExpenses: plan?.lockedExpenses ?? 0,
    lockedSettlements: plan?.lockedSettlements ?? 0,
  });
});
