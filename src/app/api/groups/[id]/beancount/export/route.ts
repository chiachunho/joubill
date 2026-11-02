import { NextResponse } from "next/server";

import { withAuth } from "@/lib/auth/route";
import { buildBeancountExport, saveBeancountWatermark } from "@/lib/beancount-export";
import { contentDisposition } from "@/lib/csv";

import { readExportRequest, type Params } from "./shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The caller's personal beancount ledger for this group, as a download (the Web App).
 * The watermark moves once the file is built: the server can't see whether the
 * browser saved it, and 全部 is always there to start over.
 */
export const GET = withAuth(async (req: Request, ctx: Params) => {
  const request = await readExportRequest(req, ctx, new URL(req.url).searchParams);
  const { user, groupId, range } = request;

  const file = await buildBeancountExport(user.id, groupId, range);
  if (!file) return NextResponse.json({ error: "group not found" }, { status: 404 });
  if (file.watermark) {
    await saveBeancountWatermark(user.id, groupId, file.watermark, file.eventAccount);
  }

  return new Response(file.text, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": contentDisposition(file.filename),
      "Cache-Control": "no-store",
    },
  });
});
