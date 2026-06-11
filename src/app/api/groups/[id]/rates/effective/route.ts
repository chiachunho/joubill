import { NextResponse } from "next/server";
import { and, count, eq, isNull, ne, or } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { expenses, groups } from "@/db/schema";
import { assertGroupMember, getAuth } from "@/lib/auth";
import { withAuth } from "@/lib/auth/route";
import { getRate, loadGroupRateOverrides, overrideKey } from "@/lib/fx";
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
 * `affectedExpenses` counts the group's existing expenses in `base` that a
 * group custom rate would re-convert — i.e. those without an applicable
 * per-expense pinned rate. Used by the settings page to warn before saving.
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
      affectedExpenses: 0,
    });
  }

  // Pins only apply while fx_quote matches the current default currency, so an
  // expense counts as affected when it has no pin or the pin is dormant.
  const [affected] = await db
    .select({ count: count() })
    .from(expenses)
    .where(
      and(
        eq(expenses.groupId, groupId),
        eq(expenses.currency, base),
        or(isNull(expenses.fxRate), isNull(expenses.fxQuote), ne(expenses.fxQuote, quote)),
      ),
    );

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
    affectedExpenses: affected.count,
  });
});
