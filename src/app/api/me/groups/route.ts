import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { groupMembers, groups } from "@/db/schema";
import { getAuth } from "@/lib/auth";
import { withAuth } from "@/lib/auth/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAuth(async (req: Request) => {
  const auth = await getAuth(req);

  const rows = await db
    .select({
      id: groups.id,
      title: groups.title,
      defaultCurrency: groups.defaultCurrency,
    })
    .from(groups)
    .innerJoin(groupMembers, eq(groupMembers.groupId, groups.id))
    .where(eq(groupMembers.userId, auth.user.id));

  return NextResponse.json({
    groups: rows,
    activeGroupId: auth.groupFromParam?.id ?? null,
  });
});
