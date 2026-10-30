import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { authIdentities } from "@/db/schema";
import { getAuth } from "@/lib/auth";
import { githubEnabled, googleEnabled, lineEnabled } from "@/lib/auth/providers";
import { withAuth } from "@/lib/auth/route";
import type { IdentitiesResponse } from "@/lib/api-types";
import { LOGIN_PROVIDERS, type LoginProvider } from "@/lib/identities";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ENABLED: Record<LoginProvider, boolean> = {
  telegram: true,
  line: lineEnabled,
  google: googleEnabled,
  github: githubEnabled,
};

export const GET = withAuth(async (req: Request) => {
  const auth = await getAuth(req);
  const rows = await db
    .select({ provider: authIdentities.provider })
    .from(authIdentities)
    .where(eq(authIdentities.userId, auth.user.id));

  const body: IdentitiesResponse = {
    linked: [...new Set(rows.map((r) => r.provider))],
    enabled: LOGIN_PROVIDERS.filter((p) => p === "telegram" || ENABLED[p]),
  };
  return NextResponse.json(body);
});
