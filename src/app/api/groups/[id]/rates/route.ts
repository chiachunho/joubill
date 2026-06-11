import { NextResponse } from "next/server";
import { and, asc, eq, inArray, isNull, ne, or } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { expenses, groupExchangeRates, groups } from "@/db/schema";
import { assertGroupMember, getAuth } from "@/lib/auth";
import { withAuth } from "@/lib/auth/route";
import { getRate, loadGroupRateOverrides } from "@/lib/fx";
import { n } from "@/lib/money";
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

  // Resolve the pins BEFORE the new rate exists: each affected expense gets its
  // current effective rate (old group rate or market rate as of spent_at), so
  // existing balances don't move. Network/cache lookups happen outside the
  // transaction below.
  let pinUpdates: Array<{ ids: number[]; rate: string }> = [];
  let pinQuote: string | null = null;
  let lockedCount = 0;
  if (lockExisting) {
    const [group] = await db
      .select({ defaultCurrency: groups.defaultCurrency })
      .from(groups)
      .where(eq(groups.id, groupId));
    if (!group) return NextResponse.json({ error: "group not found" }, { status: 404 });
    pinQuote = group.defaultCurrency;

    if (base !== pinQuote) {
      const overrides = await loadGroupRateOverrides(groupId);
      const affected = await db
        .select({ id: expenses.id, spentAt: expenses.spentAt })
        .from(expenses)
        .where(
          and(
            eq(expenses.groupId, groupId),
            eq(expenses.currency, base),
            or(
              isNull(expenses.fxRate),
              isNull(expenses.fxQuote),
              ne(expenses.fxQuote, pinQuote),
            ),
          ),
        );

      try {
        const rateByDay = new Map<string, number>();
        const idsByRate = new Map<string, number[]>();
        for (const e of affected) {
          const day = e.spentAt.toISOString().slice(0, 10);
          let r = rateByDay.get(day);
          if (r === undefined) {
            r = await getRate(base, pinQuote, e.spentAt, overrides);
            rateByDay.set(day, r);
          }
          const key = String(r);
          const ids = idsByRate.get(key) ?? [];
          ids.push(e.id);
          idsByRate.set(key, ids);
        }
        pinUpdates = Array.from(idsByRate.entries()).map(([r, ids]) => ({ ids, rate: r }));
      } catch {
        return NextResponse.json(
          { error: "無法取得既有紀錄的歷史匯率，請稍後再試" },
          { status: 502 },
        );
      }
      lockedCount = affected.length;
    }
  }

  const row = await db.transaction(async (tx) => {
    for (const u of pinUpdates) {
      await tx
        .update(expenses)
        .set({ fxRate: u.rate, fxQuote: pinQuote, updatedAt: new Date() })
        .where(inArray(expenses.id, u.ids));
    }
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
    lockedExpenses: lockedCount,
  });
});

const deleteSchema = z.object({
  base: z.enum(SUPPORTED_CURRENCIES),
  quote: z.enum(SUPPORTED_CURRENCIES),
});

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

  await db
    .delete(groupExchangeRates)
    .where(
      and(
        eq(groupExchangeRates.groupId, groupId),
        eq(groupExchangeRates.base, parsed.data.base),
        eq(groupExchangeRates.quote, parsed.data.quote),
      ),
    );

  return NextResponse.json({ ok: true });
});
