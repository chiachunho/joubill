import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { groups } from "@/db/schema";
import { assertGroupMember, getAuth } from "@/lib/auth";
import { withAuth } from "@/lib/auth/route";
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

  return NextResponse.json({ defaultCurrency: group.defaultCurrency });
});

const patchSchema = z.object({
  defaultCurrency: z.enum(SUPPORTED_CURRENCIES),
});

export const PATCH = withAuth(async (req: Request, { params }: Params) => {
  const auth = await getAuth(req);
  const groupId = Number((await params).id);
  if (!Number.isFinite(groupId)) {
    return NextResponse.json({ error: "invalid group id" }, { status: 400 });
  }
  await assertGroupMember(auth.user.id, groupId);

  const body = patchSchema.safeParse(await req.json());
  if (!body.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const [updated] = await db
    .update(groups)
    .set({ defaultCurrency: body.data.defaultCurrency, updatedAt: new Date() })
    .where(eq(groups.id, groupId))
    .returning({ defaultCurrency: groups.defaultCurrency });

  if (!updated) return NextResponse.json({ error: "group not found" }, { status: 404 });

  return NextResponse.json({ defaultCurrency: updated.defaultCurrency });
});
