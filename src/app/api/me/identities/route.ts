import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { authIdentities } from "@/db/schema";
import { getAuth } from "@/lib/auth";
import { githubEnabled, googleEnabled, lineEnabled } from "@/lib/auth/providers";
import { withAuth } from "@/lib/auth/route";
import type { IdentitiesResponse } from "@/lib/api-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAuth(async (req: Request) => {
  const auth = await getAuth(req);
  const rows = await db
    .select({ provider: authIdentities.provider })
    .from(authIdentities)
    .where(eq(authIdentities.userId, auth.user.id));

  const body: IdentitiesResponse = {
    linked: [...new Set(rows.map((r) => r.provider))],
    enabled: [
      "telegram",
      ...(lineEnabled ? ["line"] : []),
      ...(googleEnabled ? ["google"] : []),
      ...(githubEnabled ? ["github"] : []),
    ],
  };
  return NextResponse.json(body);
});
