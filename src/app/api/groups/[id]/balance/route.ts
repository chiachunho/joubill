import { NextResponse } from "next/server";
import { eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { groups, users } from "@/db/schema";
import { assertGroupMember, getAuth } from "@/lib/auth";
import { withAuth } from "@/lib/auth/route";
import { computeGroupBalances } from "@/lib/settlement";

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

  const [group] = await db.select().from(groups).where(eq(groups.id, groupId));
  if (!group) {
    return NextResponse.json({ error: "group not found" }, { status: 404 });
  }

  const balances = await computeGroupBalances(groupId, group.defaultCurrency);
  if (balances.length === 0) {
    return NextResponse.json({ currency: group.defaultCurrency, balances: [] });
  }

  const profileRows = await db
    .select({ id: users.id, firstName: users.firstName, username: users.username })
    .from(users)
    .where(inArray(users.id, balances.map((b) => b.userId)));
  const profiles = new Map(profileRows.map((p) => [p.id, p]));

  return NextResponse.json({
    currency: group.defaultCurrency,
    balances: balances
      .sort((a, b) => b.amount - a.amount)
      .map((b) => ({
        userId: b.userId,
        amount: b.amount,
        firstName: profiles.get(b.userId)?.firstName ?? null,
        username: profiles.get(b.userId)?.username ?? null,
      })),
  });
});
