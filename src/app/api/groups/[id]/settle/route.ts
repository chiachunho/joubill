import { NextResponse } from "next/server";
import { eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { groups, users } from "@/db/schema";
import { assertGroupMember, getAuth } from "@/lib/auth";
import { withAuth } from "@/lib/auth/route";
import { computeGroupBalances, minimizeTransfers } from "@/lib/settlement";
import { requireId } from "@/lib/route-params";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export const GET = withAuth(async (req: Request, { params }: Params) => {
  const auth = await getAuth(req);
  const groupId = requireId((await params).id, "group id");
  await assertGroupMember(auth.user.id, groupId);

  const [group] = await db.select().from(groups).where(eq(groups.id, groupId));
  if (!group) {
    return NextResponse.json({ error: "group not found" }, { status: 404 });
  }

  const balances = await computeGroupBalances(groupId, group.defaultCurrency);
  const transfers = minimizeTransfers(balances);
  if (transfers.length === 0) {
    return NextResponse.json({ currency: group.defaultCurrency, transfers: [] });
  }

  const involvedIds = Array.from(new Set(transfers.flatMap((t) => [t.fromUserId, t.toUserId])));
  const profileRows = await db
    .select({
      id: users.id,
      displayName: users.displayName,
      firstName: users.firstName,
      lastName: users.lastName,
      username: users.username,
    })
    .from(users)
    .where(inArray(users.id, involvedIds));
  const profiles = new Map(profileRows.map((p) => [p.id, p]));

  return NextResponse.json({
    currency: group.defaultCurrency,
    transfers: transfers.map((t) => ({
      fromUserId: t.fromUserId,
      toUserId: t.toUserId,
      amount: t.amount,
      from: profiles.get(t.fromUserId) ?? null,
      to: profiles.get(t.toUserId) ?? null,
    })),
  });
});
