import { assertGroupMember, getAuth } from "@/lib/auth";
import { BadRequestError } from "@/lib/auth/errors";
import { parseBeancountRange, type BeancountRangeQuery } from "@/lib/beancount-range";
import { requireId } from "@/lib/route-params";

export type Params = { params: Promise<{ id: string }> };

/** Auth, membership and the range: what all three export routes check first. */
export async function readExportRequest(
  req: Request,
  ctx: Params,
  params: URLSearchParams | Record<string, unknown>,
): Promise<{
  user: Awaited<ReturnType<typeof getAuth>>["user"];
  groupId: number;
  range: BeancountRangeQuery;
}> {
  const auth = await getAuth(req);
  const groupId = requireId((await ctx.params).id, "group id");
  await assertGroupMember(auth.user.id, groupId);
  const range = parseBeancountRange(params);
  if ("error" in range) throw new BadRequestError(range.error);
  return { user: auth.user, groupId, range };
}
