import { NextResponse } from "next/server";

import { withAuth } from "@/lib/auth/route";
import { summariseBeancountExport } from "@/lib/beancount-export";

import { readExportRequest, type Params } from "../shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** What the export page shows before the user commits: counts, the watermark, and whether a DM can reach them. */
export const GET = withAuth(async (req: Request, ctx: Params) => {
  const request = await readExportRequest(req, ctx, new URL(req.url).searchParams);
  const { user, groupId, range } = request;

  const summary = await summariseBeancountExport(user.id, groupId, range);
  if (!summary) return NextResponse.json({ error: "group not found" }, { status: 404 });
  return NextResponse.json({ ...summary, telegramLinked: user.telegramId != null });
});
