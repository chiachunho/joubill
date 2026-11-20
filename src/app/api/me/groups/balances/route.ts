import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { groupMembers, groups } from "@/db/schema";
import type { MyBalancesResponse } from "@/lib/api-types";
import { getAuth } from "@/lib/auth";
import { withAuth } from "@/lib/auth/route";
import { computeGroupBalances } from "@/lib/settlement";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The caller's own net balance in each of their groups, in that group's default currency (they
 * are never added up). Separate from `GET /api/me/groups` so the list shows at once and the
 * balances, which convert every record, fill in after it.
 */
export const GET = withAuth(async (req: Request) => {
  const auth = await getAuth(req);

  const rows = await db
    .select({ id: groups.id, defaultCurrency: groups.defaultCurrency })
    .from(groups)
    .innerJoin(groupMembers, eq(groupMembers.groupId, groups.id))
    .where(eq(groupMembers.userId, auth.user.id));

  const balances: MyBalancesResponse["balances"] = {};
  await Promise.all(
    rows.map(async (g) => {
      const all = await computeGroupBalances(g.id, g.defaultCurrency);
      const amount = all.find((b) => b.userId === auth.user.id)?.amount ?? 0;
      balances[g.id] = { amount, currency: g.defaultCurrency };
    }),
  );

  return NextResponse.json({ balances } satisfies MyBalancesResponse);
});
