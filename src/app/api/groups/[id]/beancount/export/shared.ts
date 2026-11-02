import { NextResponse } from "next/server";

import { assertGroupMember, getAuth } from "@/lib/auth";
import { parseBeancountRange, type BeancountRangeQuery } from "@/lib/beancount-range";

export type Params = { params: Promise<{ id: string }> };

/** Auth, membership and the range: what all three export routes check first. */
export async function readExportRequest(
  req: Request,
  ctx: Params,
  params: URLSearchParams | Record<string, unknown>,
): Promise<
  | {
      ok: true;
      user: Awaited<ReturnType<typeof getAuth>>["user"];
      groupId: number;
      range: BeancountRangeQuery;
    }
  | { ok: false; response: NextResponse }
> {
  const auth = await getAuth(req);
  const groupId = Number((await ctx.params).id);
  if (!Number.isFinite(groupId)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "invalid group id" }, { status: 400 }),
    };
  }
  await assertGroupMember(auth.user.id, groupId);
  const range = parseBeancountRange(params);
  if ("error" in range) {
    return { ok: false, response: NextResponse.json({ error: range.error }, { status: 400 }) };
  }
  return { ok: true, user: auth.user, groupId, range };
}
