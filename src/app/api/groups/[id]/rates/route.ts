import { NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { groupExchangeRates, groups } from "@/db/schema";
import { assertGroupMember, getAuth } from "@/lib/auth";
import { withAuth } from "@/lib/auth/route";
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
  const { base, quote, rate } = body.data;

  const [row] = await db
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

  return NextResponse.json({
    id: row.id,
    base: row.base,
    quote: row.quote,
    rate: n(row.rate),
    updatedAt: row.updatedAt,
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
