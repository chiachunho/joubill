import { NextResponse } from "next/server";

import { assertGroupMember, getAuth } from "@/lib/auth";
import { withAuth } from "@/lib/auth/route";
import { loadGroupActivity, loadRecordHistory } from "@/lib/record-history";
import { requireId } from "@/lib/route-params";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * The audit log for a group, or for one record inside it.
 *
 * Both views are the same list under a different filter, so they share one
 * handler and one membership check. `?record=<id>` returns that record's whole
 * history (including the group rate locks that rewrote it); without it, the
 * group feed, paged with `?cursor=<id>`.
 */
export const GET = withAuth(async (req: Request, { params }: Params) => {
  const auth = await getAuth(req);
  const groupId = requireId((await params).id, "group id");
  await assertGroupMember(auth.user.id, groupId);

  const url = new URL(req.url);

  const recordParam = url.searchParams.get("record");
  if (recordParam != null) {
    const recordId = requireId(recordParam, "record id");
    // No existence check: a deleted record still has a history, and refusing to
    // show it would hide the deletion — the one entry most worth reading.
    return NextResponse.json({
      entries: await loadRecordHistory(groupId, recordId),
      nextCursor: null,
    });
  }

  const cursorParam = url.searchParams.get("cursor");
  const cursor = cursorParam != null ? requireId(cursorParam, "cursor") : undefined;

  return NextResponse.json(await loadGroupActivity(groupId, cursor));
});
