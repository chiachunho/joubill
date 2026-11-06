import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { groups } from "@/db/schema";
import { assertGroupMember, getAuth } from "@/lib/auth";
import { withAuth } from "@/lib/auth/route";
import { changeGroupTimezone } from "@/lib/group-timezone";
import { isValidTimeZone } from "@/lib/timezone";
import { SUPPORTED_CURRENCIES } from "@/lib/zod";
import { requireId } from "@/lib/route-params";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export const GET = withAuth(async (req: Request, { params }: Params) => {
  const auth = await getAuth(req);
  const groupId = requireId((await params).id, "group id");
  await assertGroupMember(auth.user.id, groupId);

  const [group] = await db
    .select({ defaultCurrency: groups.defaultCurrency, timezone: groups.timezone })
    .from(groups)
    .where(eq(groups.id, groupId));
  if (!group) return NextResponse.json({ error: "group not found" }, { status: 404 });

  return NextResponse.json({ defaultCurrency: group.defaultCurrency, timezone: group.timezone });
});

const patchSchema = z
  .object({
    defaultCurrency: z.enum(SUPPORTED_CURRENCIES).optional(),
    // Checked against Intl.supportedValuesOf("timeZone"): an arbitrary string is refused.
    timezone: z.string().refine(isValidTimeZone, "invalid timezone").optional(),
  })
  .refine((b) => b.defaultCurrency !== undefined || b.timezone !== undefined, "nothing to change");

export const PATCH = withAuth(async (req: Request, { params }: Params) => {
  const auth = await getAuth(req);
  const groupId = requireId((await params).id, "group id");
  await assertGroupMember(auth.user.id, groupId);

  const body = patchSchema.safeParse(await req.json());
  if (!body.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  if (body.data.timezone !== undefined) {
    const result = await changeGroupTimezone(groupId, body.data.timezone, {
      userId: auth.user.id,
      source: "app",
    });
    if (!result.ok) {
      return result.reason === "not_found"
        ? NextResponse.json({ error: "group not found" }, { status: 404 })
        : NextResponse.json({ error: "invalid timezone" }, { status: 400 });
    }
  }

  if (body.data.defaultCurrency !== undefined) {
    await db
      .update(groups)
      .set({ defaultCurrency: body.data.defaultCurrency, updatedAt: new Date() })
      .where(eq(groups.id, groupId));
  }

  const [updated] = await db
    .select({ defaultCurrency: groups.defaultCurrency, timezone: groups.timezone })
    .from(groups)
    .where(eq(groups.id, groupId));
  if (!updated) return NextResponse.json({ error: "group not found" }, { status: 404 });

  return NextResponse.json({
    defaultCurrency: updated.defaultCurrency,
    timezone: updated.timezone,
  });
});
