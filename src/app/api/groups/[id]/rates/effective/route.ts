import { NextResponse } from "next/server";
import { and, count, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { expenses, groups, settlements } from "@/db/schema";
import { assertGroupMember, getAuth } from "@/lib/auth";
import { withAuth } from "@/lib/auth/route";
import { getRate, loadGroupRateOverrides, overrideKey } from "@/lib/fx";
import { noApplicablePin } from "@/lib/rate-lock";
import { SUPPORTED_CURRENCIES } from "@/lib/zod";

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
  const groupId = Number((await params).id);
  if (!Number.isFinite(groupId)) {
    return NextResponse.json({ error: "invalid group id" }, { status: 400 });
  }
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
            eq(expenses.currency, base),
            noApplicablePin(expenses, quote),
          ),
        ),
      db
        .select({ count: count() })
        .from(settlements)
        .where(
          and(
            eq(settlements.groupId, groupId),
            eq(settlements.currency, base),
            noApplicablePin(settlements, quote),
          ),
        ),
    ]);
    counts = {
      affectedExpenses: affected.count,
      affectedSettlements: affectedSettled.count,
    };
  }

  const overrides = await loadGroupRateOverrides(groupId);
  const override = overrides.get(overrideKey(base, quote)) ?? null;

  let marketRate: number | null = null;
  try {
    marketRate = await getRate(base, quote, date ? new Date(`${date}T12:00:00Z`) : new Date());
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
