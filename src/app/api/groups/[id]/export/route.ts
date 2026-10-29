import { NextResponse } from "next/server";

import { assertGroupMember, getAuth } from "@/lib/auth";
import { withAuth } from "@/lib/auth/route";
import { contentDisposition } from "@/lib/csv";
import { buildGroupExport } from "@/lib/export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** The group's records as a CSV download (UTF-8 with BOM so Excel reads the Chinese). */
export const GET = withAuth(async (req: Request, { params }: Params) => {
  const auth = await getAuth(req);
  const groupId = Number((await params).id);
  if (!Number.isFinite(groupId)) {
    return NextResponse.json({ error: "invalid group id" }, { status: 400 });
  }
  await assertGroupMember(auth.user.id, groupId);

  if (new URL(req.url).searchParams.get("format") !== "csv") {
    return NextResponse.json({ error: "format must be csv" }, { status: 400 });
  }

  const file = await buildGroupExport(groupId);
  if (!file) return NextResponse.json({ error: "group not found" }, { status: 404 });

  return new Response(file.csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": contentDisposition(file.filename),
      "Cache-Control": "no-store",
    },
  });
});
