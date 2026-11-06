import { NextResponse } from "next/server";
import { and, count, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { expenses, groups } from "@/db/schema";
import { assertGroupMember, getAuth } from "@/lib/auth";
import { withAuth } from "@/lib/auth/route";
import { todayIn } from "@/lib/day";
import { getRate, loadGroupRateContext, overrideKey } from "@/lib/fx";
import { noApplicablePin } from "@/lib/rate-lock";
import { SUPPORTED_CURRENCIES } from "@/lib/zod";
import { requireId } from "@/lib/route-params";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const querySchema = z.object({
  base: z.enum(SUPPORTED_CURRENCIES),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

/**
 * Effective rate to convert `base` into the group's default currency:
 * the group custom rate when one is set, otherwise the market rate as of
 * `date` (default today). `marketRate` is always included as a reference
 * (null when the FX API is unreachable and the cache is empty).
 *
 * With `?counts=1`, the response also includes `affectedExpenses` /
 * `affectedSettlements` — the group's existing records in `base` that a group
 * custom rate would re-convert (those without an applicable pinned rate).
 * Used by the settings page to warn before saving or deleting a group rate;
 * the expense form omits it to skip the two COUNT queries.
 */
export const GET = withAuth(async (req: Request, { params }: Params) => {
  const auth = await getAuth(req);
  const groupId = requireId((await params).id, "group id");
  await assertGroupMember(auth.user.id, groupId);

  const url = new URL(req.url);
  const parsed = querySchema.safeParse({
    base: url.searchParams.get("base"),
    date: url.searchParams.get("date") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid base/date" }, { status: 400 });
  }
  const { base, date } = parsed.data;
  const wantCounts = url.searchParams.get("counts") === "1";

  const [group] = await db
    .select({ defaultCurrency: groups.defaultCurrency })
    .from(groups)
    .where(eq(groups.id, groupId));
  if (!group) return NextResponse.json({ error: "group not found" }, { status: 404 });

  const quote = group.defaultCurrency;
  if (base === quote) {
    return NextResponse.json({
      base,
      quote,
      rate: 1,
      source: "same",
      marketRate: 1,
      ...(wantCounts && { affectedExpenses: 0, affectedSettlements: 0 }),
    });
  }

  let counts: { affectedExpenses: number; affectedSettlements: number } | null = null;
  if (wantCounts) {
    const [[affected], [affectedSettled]] = await Promise.all([
      db
        .select({ count: count() })
        .from(expenses)
        .where(
          and(
            eq(expenses.groupId, groupId),
            eq(expenses.type, "expense"),
            eq(expenses.currency, base),
            noApplicablePin(expenses, quote),
          ),
        ),
      db
        .select({ count: count() })
        .from(expenses)
        .where(
          and(
            eq(expenses.groupId, groupId),
            eq(expenses.type, "settlement"),
            eq(expenses.currency, base),
            noApplicablePin(expenses, quote),
          ),
        ),
    ]);
    counts = {
      affectedExpenses: affected.count,
      affectedSettlements: affectedSettled.count,
    };
  }

  const rateCtx = await loadGroupRateContext(groupId);
  const override = rateCtx.overrides.get(overrideKey(base, quote)) ?? null;

  let marketRate: number | null = null;
  try {
    marketRate = await getRate(base, quote, date ?? todayIn(rateCtx.timeZone), rateCtx);
  } catch {
    // FX API unreachable and no cached rate — leave marketRate null.
  }

  const rate = override ?? marketRate;
  return NextResponse.json({
    base,
    quote,
    rate,
    source: override != null ? "group" : marketRate != null ? "market" : null,
    marketRate,
    ...counts,
  });
});
