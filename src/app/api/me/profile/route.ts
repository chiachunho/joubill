import { NextResponse } from "next/server";

import { getAuth } from "@/lib/auth";
import { withAuth } from "@/lib/auth/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAuth(async (req: Request) => {
  const auth = await getAuth(req);
  const { firstName, lastName, username } = auth.user;

  return NextResponse.json({ firstName, lastName, username });
});
