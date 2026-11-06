import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/db";
import { groupMembers, groups } from "@/db/schema";
import { assertMemberOfAll } from "@/lib/mcp-connections-db";
import { getAuth } from "@/lib/auth";
import { BadRequestError, ForbiddenError } from "@/lib/auth/errors";
import { withAuth } from "@/lib/auth/route";
import { createCode, parseAuthorizeRequest, redirectWith } from "@/lib/oauth-db";
import { issuer } from "@/lib/oauth-http";
import { redirectLabel } from "@/lib/oauth";
import { enforceOauthRateLimit } from "@/lib/rate-limit";
import { RATE_RULES } from "@/lib/rate-limits";
import { appUrl } from "@/lib/help-url";
import { idSchema } from "@/lib/zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The authorize parameters the consent page forwards, in a body or a query. */
const KEYS = [
  "client_id",
  "redirect_uri",
  "response_type",
  "code_challenge",
  "code_challenge_method",
  "scope",
  "state",
  "resource",
] as const;

const fail = (r: Extract<Awaited<ReturnType<typeof parseAuthorizeRequest>>, { ok: false }>) =>
  NextResponse.json(
    {
      error: r.error,
      error_description: r.description,
      // Only a request with a trusted redirect URI may send the person back to the client.
      redirectTo: r.redirect
        ? redirectWith(r.redirectUri, issuer(), {
            error: r.error,
            error_description: r.description,
            state: r.state,
          })
        : null,
    },
    { status: 400 },
  );

/** What the consent page shows: who is asking, for how much, and the groups to choose from. */
export const GET = withAuth(async (req: Request) => {
  const auth = await getAuth(req);
  await enforceOauthRateLimit(req, RATE_RULES.oauthConsentUser, auth.user.id);
  const params = new URL(req.url).searchParams;
  const parsed = await parseAuthorizeRequest((k) => params.get(k));
  if (!parsed.ok) return fail(parsed);
  const mine = await db
    .select({ id: groups.id, title: groups.title, defaultCurrency: groups.defaultCurrency })
    .from(groupMembers)
    .innerJoin(groups, eq(groups.id, groupMembers.groupId))
    .where(eq(groupMembers.userId, auth.user.id));
  return NextResponse.json({
    client: {
      name: parsed.request.client.name,
      redirectLabel: redirectLabel(parsed.request.redirectUri),
    },
    requestedAccess: parsed.request.requested,
    groups: mine.sort((a, b) => a.id - b.id),
  });
});

const decisionSchema = z.object({
  params: z.record(z.string(), z.string()),
  approve: z.boolean(),
  access: z.enum(["read", "write"]).default("read"),
  allGroups: z.boolean().default(false),
  groupIds: z.array(idSchema).max(200).default([]),
});

/** The person's decision. The request is checked again: the body is not trusted. */
export const POST = withAuth(async (req: Request) => {
  // A cookie-authenticated POST: only our own pages may make it.
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(appUrl("/")).origin) {
    throw new ForbiddenError("cross-origin request");
  }
  const auth = await getAuth(req);
  await enforceOauthRateLimit(req, RATE_RULES.oauthConsentUser, auth.user.id);
  const body = decisionSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) throw new BadRequestError("invalid body");
  const input = body.data;

  const parsed = await parseAuthorizeRequest((k) =>
    (KEYS as readonly string[]).includes(k) ? input.params[k] : null,
  );
  if (!parsed.ok) return fail(parsed);
  const { request } = parsed;

  if (!input.approve) {
    return NextResponse.json({
      redirectTo: redirectWith(request.redirectUri, issuer(), {
        error: "access_denied",
        error_description: "the user denied the request",
        state: request.state,
      }),
    });
  }
  const groupIds = [...new Set(input.groupIds)];
  if (!input.allGroups && groupIds.length === 0) {
    throw new BadRequestError("choose at least one group, or all groups");
  }
  if (!input.allGroups) await assertMemberOfAll(auth.user.id, groupIds);

  const code = await createCode(request, auth.user.id, {
    access: input.access,
    allGroups: input.allGroups,
    groupIds,
  });
  return NextResponse.json({
    redirectTo: redirectWith(request.redirectUri, issuer(), { code, state: request.state }),
  });
});
