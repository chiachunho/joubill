import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { groups } from "@/db/schema";
import { assertGroupMember, getAuth } from "@/lib/auth";
import { withAuth } from "@/lib/auth/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export const DELETE = withAuth(async (req: Request, { params }: Params) => {
  const auth = await getAuth(req);
  const { id } = await params;
  const groupId = Number(id);

  if (!Number.isFinite(groupId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  await assertGroupMember(auth.user.id, groupId);

  await db.delete(groups).where(eq(groups.id, groupId));

  return NextResponse.json({ ok: true });
});
